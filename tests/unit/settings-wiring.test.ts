/**
 * Guard against dead settings.
 *
 * The Settings screen once exposed eleven controls that no code read: "analyse
 * immediately", "store ROM bytes", "store save states", the scaling selector,
 * the audio buffer size, fullscreen-on-launch, the FPS toggle and others all
 * wrote a value into IndexedDB and changed nothing. That is the exact failure
 * mode this repository forbids — a control that claims to do something and does
 * not — and it is invisible to any test of a single screen.
 *
 * This test reads the real source tree and asserts that every key on
 * `AppSettings` is consulted somewhere outside the settings store and outside
 * the Settings page itself. Adding a setting without wiring it up fails here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const SRC = join(ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/** Keys declared on the AppSettings interface, in declaration order. */
function declaredSettingsKeys(): string[] {
  const types = readFileSync(join(SRC, 'core', 'types.ts'), 'utf8');
  const match = /export interface AppSettings \{([\s\S]*?)\n\}/.exec(types);
  expect(match, 'AppSettings interface not found in src/core/types.ts').toBeTruthy();
  return [...match![1]!.matchAll(/^ {2}([a-zA-Z][\w]*)\??:/gm)].map((m) => m[1]!);
}

/**
 * Matches a real read of `key`: `settings.key`, `settings?.key`,
 * `settingsSnapshot().key` or a selector such as
 * `useSettings((s) => s.settings.key)`.
 *
 * Built with `String.raw` so the escaping is unambiguous, and self-tested below
 * so it can never quietly stop matching and let every key look "wired".
 */
function readPattern(key: string): RegExp {
  return new RegExp(String.raw`(?:settings|settingsSnapshot\(\))\??\.` + key + String.raw`\b`);
}

describe('every AppSettings key is actually consumed', () => {
  // The store reads its own keys, the type declares them, and the Settings page
  // reads them to draw its controls — none of that is consumption. A key must
  // be read by real behaviour (player, ingest, engines, planning) to count.
  const ignored = new Set([
    join(SRC, 'state', 'settings.ts'),
    join(SRC, 'core', 'types.ts'),
    join(SRC, 'ui', 'pages', 'SettingsPage.tsx'),
  ]);

  it('parses the settings contract', () => {
    const keys = declaredSettingsKeys();
    expect(keys.length).toBeGreaterThanOrEqual(15);
    expect(keys).toContain('storePayloads');
    expect(keys).toContain('videoScale');
    // Removed because nothing implemented them.
    expect(keys).not.toContain('theme');
    expect(keys).not.toContain('performanceMode');
    expect(keys).not.toContain('telemetry');
  });

  it('has a detector that actually matches the read forms used in this codebase', () => {
    const forms = [
      'const x = settings.volume;',
      'const x = settings?.volume;',
      'const x = settingsSnapshot().volume;',
      'const x = useSettings((s) => s.settings.volume);',
    ];
    for (const source of forms) expect(readPattern('volume').test(source), source).toBe(true);
    // Must not match a longer key that merely starts with the same text...
    expect(readPattern('volume').test('settings.volumeBoost')).toBe(false);
    // ...nor a different object's property.
    expect(readPattern('volume').test('config.volume')).toBe(false);
  });

  it('finds a real read for each key', () => {
    const files = walk(SRC).filter((f) => !ignored.has(f));
    const sources = files.map((file) => ({ file, text: readFileSync(file, 'utf8') }));

    const dead: string[] = [];
    for (const key of declaredSettingsKeys()) {
      const pattern = readPattern(key);
      if (!sources.some((s) => pattern.test(s.text))) dead.push(key);
    }

    expect(
      dead,
      'These AppSettings keys are declared and editable but never read by any code, ' +
        `so the matching control cannot work: ${dead.join(', ')}`,
    ).toEqual([]);
  });

  it('does not leave the old no-op arithmetic behind', () => {
    const player = readFileSync(join(SRC, 'ui', 'player', 'Player.tsx'), 'utf8');
    // The old code returned 1 from every branch of the scale ternary.
    expect(player).not.toMatch(/scale=\{settings\.videoScale ===/);
    // ...and resolved every aspect to 4:3 regardless of platform.
    expect(player).not.toMatch(/game\.platformId === 'gba' \? '4:3' : '4:3'/);
    expect(player).toContain('resolveAspect(settings.aspect, game.platformId)');
  });
});
