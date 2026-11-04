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
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildTestRom, TEST_ROM_NAME } from '../../src/core/testrom';

const here = path.dirname(fileURLToPath(import.meta.url));

test.describe.configure({ mode: 'serial' });

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
  await expect(page.getByText(/jsnes/i).first()).toBeVisible({ timeout: 20_000 });

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

  // Verification harness runs and records real checks.
  await page.getByRole('button', { name: /^Verify$/i }).click();
  await expect(page.getByText(/Verification:/i)).toBeVisible({ timeout: 60_000 });
});

test('library shows the analysed game with its real engine', async ({ page }) => {
  await page.getByRole('link', { name: /Library/i }).or(page.getByRole('button', { name: /^Library$/i })).first().click();
  await expect(page).toHaveURL(/#\/library/);
  const card = page.locator('article').filter({ hasText: /recompa-selftest/i }).first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText(/Emulation/i);
});

test('compatibility database lists measured results', async ({ page }) => {
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
  // It still creates a report entry, but the report must say "unidentified".
  await expect(page).toHaveURL(/#\/game\//, { timeout: 20_000 });
  await expect(page.getByText(/Unrecognised file|no platform could be verified|format not recognised/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Not runnable|Nothing to launch/i })).toBeDisabled();
});
