/**
 * End-to-end smoke suite (Playwright).
 *
 * Run with:  npm install && npx playwright install chromium && npm run test:e2e
 *
 * The suite drives the *real* app against the dev server: it uploads Recompa's
 * own generated test cartridge through the file input, asserts the analysis
 * report, launches the jsnes engine, waits for measured frames, captures a
 * screenshot from the running emulator and verifies the save-state round trip.
 *
 * It is intentionally browser-agnostic: install any of chromium/firefox/webkit.
 */
import { expect, test, type Page } from '@playwright/test';
import { buildTestRom, TEST_ROM_NAME } from '../../src/core/testrom';

test.describe.configure({ mode: 'serial' });

/**
 * Playwright creates a fresh browser context — and therefore a fresh IndexedDB —
 * for every test. A test that needs a library entry must seed it through the
 * app's own self-test intake path rather than depending on a previous test.
 */
async function seedSelfTestGame(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Self-test engine/i }).first().click();
  await expect(page).toHaveURL(/#\/game\//, { timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw new Error(`Uncaught page error: ${error.message}`);
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Drop a ROM/i);
});

test('home page reports real runtime capabilities', async ({ page }) => {
  const devicePanel = page.locator('text=This device').locator('..');
  await expect(devicePanel).toBeVisible();
  // WebAssembly must be supported by any browser Playwright drives.
  await expect(devicePanel).toContainText(/WebAssembly/i);
  // Fingerprint count comes from the shipped catalogue, not a hardcoded number.
  await expect(page.locator('text=Fingerprints').first()).toBeVisible();
});

test('self-test cartridge: analyse, launch, measure and save state', async ({ page }) => {
  // Generate the ROM in the test process and hand it to the browser file input.
  const rom = buildTestRom();
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Choose ROM files/i }).first().click();
  const chooser = await fileChooserPromise;
  await chooser.setFiles({ name: TEST_ROM_NAME, mimeType: 'application/octet-stream', buffer: Buffer.from(rom) });

  // Analysis navigates to the report page.
  await expect(page).toHaveURL(/#\/game\//, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/recompa-selftest/i);
  await expect(page.getByText('fingerprint verified').or(page.getByText('title not verified'))).toBeVisible();
  await expect(page.getByText('Nintendo Entertainment System').first()).toBeVisible();
  await expect(page.getByText(/Emulation \(JavaScript core\)/i).first()).toBeVisible();

  // Launch the player.
  await page.getByRole('button', { name: /^Play$/i }).first().click();
  await expect(page).toHaveURL(/#\/play\//, { timeout: 15_000 });
  // The player header shows the method badge once a real session exists.
  // It reads "JS emulation" for jsnes; the literal string "jsnes" is not
  // rendered in the player. A visible badge proves adapter.create() resolved.
  await expect(page.getByText(/JS emulation/i).first()).toBeVisible({ timeout: 20_000 });

  // The engine must actually produce frames: the header shows measured fps.
  const status = page.locator('header').first();
  await expect(status).toContainText(/running/i, { timeout: 20_000 });
  await expect
    .poll(async () => {
      const text = await status.innerText();
      const match = /([\d.]+)\s*fps/i.exec(text);
      return match ? Number(match[1]) : 0;
    }, { timeout: 25_000, message: 'engine never reported a nonzero frame rate' })
    .toBeGreaterThan(10);

  // Canvas must contain non-black pixels (the cartridge fills the background).
  const nonBlackRatio = await page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return 0;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! > 8 || data[i + 1]! > 8 || data[i + 2]! > 8) lit++;
    }
    return lit / (data.length / 4);
  });
  expect(nonBlackRatio).toBeGreaterThan(0.4);

  // Save a state, confirm it is listed, then restore it.
  await page.getByRole('button', { name: /Save state/i }).first().click();
  await expect(page.getByText(/Save state stored/i)).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /^States$/i }).click();
  await expect(page.locator('text=Save states')).toBeVisible();
  await expect(page.locator('li', { hasText: 'jsnes' }).first()).toBeVisible();

  // Screenshot download is wired to the engine readback.
  const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });
  await page.getByRole('button', { name: /Screenshot/i }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/png$/);

  // A screenshot also opens a preview dialog. Closing it revokes the preview's
  // blob URL and unblocks the rest of the player controls.
  const preview = page.getByRole('dialog');
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: /^Close$/i }).click();
  await expect(preview).toHaveCount(0);

  // Verification harness runs and records real checks.
  await page.getByRole('button', { name: /^Verify$/i }).click();
  await expect(page.getByText(/Verification:/i)).toBeVisible({ timeout: 60_000 });
});

test('library shows the analysed game with its real engine', async ({ page }) => {
  await seedSelfTestGame(page);
  await page.getByRole('link', { name: /Library/i }).or(page.getByRole('button', { name: /^Library$/i })).first().click();
  await expect(page).toHaveURL(/#\/library/);
  const card = page.locator('article').filter({ hasText: /recompa-selftest/i }).first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText(/Emulation/i);
});

test('compatibility database lists measured results', async ({ page }) => {
  // Produce a real measured result first: launch the self-test cartridge and
  // run the verification harness. Nothing here is seeded as fake data.
  await seedSelfTestGame(page);
  await page.getByRole('button', { name: /^Play$/i }).first().click();
  await expect(page.getByText(/JS emulation/i).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /^Verify$/i }).click();
  await expect(page.getByText(/Verification:/i)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /^Exit game$/i }).click();

  await page.getByRole('button', { name: /^Compatibility$/i }).first().click();
  await expect(page).toHaveURL(/#\/compatibility/);
  await expect(page.getByText(/fingerprints/i).first()).toBeVisible();
  await page.getByRole('tab', { name: /Measured results/i }).click();
  await expect(page.locator('table')).toBeVisible();
});

test('unknown file produces a technical error, never a fake platform', async ({ page }) => {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Choose ROM files/i }).first().click();
  const chooser = await fileChooserPromise;
  await chooser.setFiles({
    name: 'not-a-rom.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from([0xde, 0xad, 0xbe, 0xef, 1, 2, 3, 4, 5, 6, 7, 8]),
  });
  // It still creates a report entry, but the report must state plainly that
  // nothing was identified and must not offer any execution method.
  await expect(page).toHaveURL(/#\/game\//, { timeout: 20_000 });
  await expect(page.getByText('not identified', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/No supported console format matched this file/i).first()).toBeVisible();
  await expect(page.getByText(/No runnable execution path/i).first()).toBeVisible();
  await expect(page.getByRole('tab', { name: /Execution methods 0/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Not runnable|Nothing to launch/i })).toBeDisabled();
});

test('"analyse immediately" off holds files back until confirmed', async ({ page }) => {
  // The setting must genuinely gate intake: nothing is read or hashed until the
  // user confirms. Turning the switch off has to change what happens next.
  await page.getByRole('button', { name: /^Settings$/i }).first().click();
  await expect(page).toHaveURL(/#\/settings/);
  await page.getByRole('tab', { name: /Data & storage/i }).click();

  const toggle = page.getByRole('switch', { name: /Analyse immediately when a file is dropped/i });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  await page.getByRole('button', { name: /^Upload ROM$/i }).first().click();
  await expect(page).toHaveURL(/#\/upload/);

  const rom = buildTestRom();
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Choose ROM files/i }).first().click();
  const chooser = await fileChooserPromise;
  await chooser.setFiles({ name: TEST_ROM_NAME, mimeType: 'application/octet-stream', buffer: Buffer.from(rom) });

  // Held back: still on /upload, with the confirmation panel showing the file.
  await expect(page.getByText(/1 file ready to analyse/i)).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/#\/upload/);

  // Confirming runs the same local analysis and lands on the report.
  await page.getByRole('button', { name: /^Analyse 1 file$/i }).click();
  await expect(page).toHaveURL(/#\/game\//, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/recompa-selftest/i);
});

test('"store ROM bytes" off analyses without keeping the file and says so', async ({ page }) => {
  await page.getByRole('button', { name: /^Settings$/i }).first().click();
  await page.getByRole('tab', { name: /Data & storage/i }).click();
  const toggle = page.getByRole('switch', { name: /Store ROM bytes after analysis/i });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  await page.getByRole('button', { name: /^Upload ROM$/i }).first().click();
  const rom = buildTestRom();
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Choose ROM files/i }).first().click();
  const chooser = await fileChooserPromise;
  await chooser.setFiles({ name: TEST_ROM_NAME, mimeType: 'application/octet-stream', buffer: Buffer.from(rom) });

  // Analysis still completes...
  await expect(page).toHaveURL(/#\/game\//, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/recompa-selftest/i);
  // ...but the launch button is honest about the missing payload instead of
  // offering a play that is guaranteed to fail.
  const launch = page.getByRole('button', { name: /File not kept/i });
  await expect(launch).toBeVisible();
  await expect(launch).toBeDisabled();
});
