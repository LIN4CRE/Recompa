import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guard against scripts that reference files which are not in the repository.
 * A `fetch:testroms` entry pointing at a non-existent `fetch-test-roms.mjs`
 * shipped in v0.1.0; nothing in the build or test suite exercised it, so it
 * stayed broken until this audit. This test makes that class of drift fail CI.
 */

const root = resolve(__dirname, '../..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('package.json script references', () => {
  const referenced = new Set<string>();
  for (const command of Object.values(pkg.scripts)) {
    for (const match of command.matchAll(/(?:scripts|server)\/[A-Za-z0-9_.-]+\.mjs/g)) {
      referenced.add(match[0]);
    }
  }

  it('references at least one local script file', () => {
    expect(referenced.size).toBeGreaterThan(0);
  });

  it('every referenced .mjs file exists', () => {
    for (const relative of referenced) {
      expect(existsSync(resolve(root, relative)), `${relative} is missing`).toBe(true);
    }
    expect([...referenced]).toContain('scripts/setup-emulatorjs.mjs');
    expect([...referenced]).toContain('server/processing-service.mjs');
  });

  it('the documented npm commands in README and the deployment guide exist', () => {
    const docs = ['README.md', 'docs/DEPLOYMENT.md'];
    const names = new Set<string>();
    for (const doc of docs) {
      const text = readFileSync(resolve(root, doc), 'utf8');
      for (const match of text.matchAll(/npm run ([A-Za-z0-9:_.-]+)/g)) names.add(match[1]!);
    }
    expect(names.size).toBeGreaterThan(0);
    for (const name of names) {
      expect(pkg.scripts[name], `npm run ${name} is documented but not defined`).toBeDefined();
    }
  });
});

describe('GitHub Actions supply chain', () => {
  const workflows = readdirSync(resolve(root, '.github/workflows')).filter((f) => f.endsWith('.yml'));

  it('finds the workflow files', () => {
    expect(workflows.length).toBeGreaterThanOrEqual(3);
  });

  it('pins every third-party action to an immutable commit SHA', () => {
    const refs: string[] = [];
    for (const file of workflows) {
      const text = readFileSync(resolve(root, '.github/workflows', file), 'utf8');
      for (const match of text.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)) refs.push(`${file}: ${match[1]}`);
    }
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const spec = ref.split(': ')[1]!;
      expect(ref, `${ref} must not use a mutable tag or branch`).toMatch(/[\w./-]+@[0-9a-f]{40}$/);
      expect(spec.startsWith('./'), `${ref} must be a pinned third-party action`).toBe(false);
    }
  });

  it('declares explicit least-privilege permissions and never persists credentials', () => {
    for (const file of workflows) {
      const text = readFileSync(resolve(root, '.github/workflows', file), 'utf8');
      expect(text, `${file} needs a permissions block`).toMatch(/^permissions:\s*$/m);
      if (/actions\/checkout@[0-9a-f]{40}/.test(text)) {
        expect(text, `${file} checkout must not persist credentials`).toMatch(/persist-credentials:\s*false/);
      }
      expect(text, `${file} must not run privileged untrusted PR code`).not.toMatch(/pull_request_target/);
    }
  });
});
