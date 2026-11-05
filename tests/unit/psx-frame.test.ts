import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMULATOR_FRAME_STYLE, mountBootstrapFrame } from '@/engines/psx/frame';
import { bootstrapHtml } from '@/engines/psx/adapter';

/**
 * These tests encode a browser behaviour that is easy to break by reordering
 * two lines: in Chromium a *detached* iframe has no browsing context, so
 * `contentDocument` / `contentWindow` are null until the element is connected.
 *
 * The fake DOM below deliberately throws if `contentDocument` is read while the
 * frame is detached. If anyone moves the write back above the insertion, the
 * test fails immediately instead of silently shipping a broken PlayStation
 * adapter again.
 */

interface FakeFrame {
  isConnected: boolean;
  src: string;
  style: { cssText: string };
  attributes: Record<string, string>;
  setAttribute(name: string, value: string): void;
  remove(): void;
  replaceWith(node: unknown): void;
  contentDocument: { open(): void; write(html: string): void; close(): void } | null;
}

function makeDom(options: { connectedCanvas?: boolean; noContentDocument?: boolean } = {}) {
  const written: string[] = [];
  let docReads = 0;
  let detachedReads = 0;
  const body = {
    children: [] as unknown[],
    child: null as unknown,
    appendChild(node: unknown) {
      this.children.push(node);
      this.child = node;
      (node as FakeFrame).isConnected = true;
    },
  };
  let frame: FakeFrame | null = null;

  const doc = {
    open() {},
    write(html: string) {
      written.push(html);
    },
    close() {},
  };

  frame = {
    isConnected: false,
    src: '',
    style: { cssText: '' },
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    remove() {
      this.isConnected = false;
    },
    replaceWith(node: unknown) {
      // Called on failure to restore the canvas.
      host.child = node;
      this.isConnected = false;
    },
    get contentDocument() {
      docReads++;
      if (!this.isConnected) {
        detachedReads++;
        throw new Error('contentDocument read on a detached iframe');
      }
      return options.noContentDocument ? null : doc;
    },
  } as FakeFrame;

  const host = {
    child: null as unknown,
    appendChild(node: unknown) {
      this.child = node;
      (node as FakeFrame).isConnected = true;
    },
  };

  const canvas = {
    parentElement: options.connectedCanvas === false ? null : host,
    isConnected: options.connectedCanvas !== false,
    replaceWith(node: unknown) {
      // A detached node has no parent to replace it in: real DOM semantics.
      if (!this.parentElement) return;
      host.child = node;
      (node as FakeFrame).isConnected = true;
      this.isConnected = false;
    },
  };

  const documentStub = {
    body,
    createElement(tag: string) {
      if (tag !== 'iframe') throw new Error(`unexpected element ${tag}`);
      return frame;
    },
  };

  vi.stubGlobal('document', documentStub);
  return {
    canvas,
    host,
    body,
    frame: frame as FakeFrame,
    written,
    stats: () => ({ docReads, detachedReads }),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('mountBootstrapFrame', () => {
  it('connects the iframe before reading its contentDocument', () => {
    const dom = makeDom();
    const result = mountBootstrapFrame(dom.canvas as unknown as HTMLCanvasElement, '<p>bootstrap</p>');

    expect(result).toBe(dom.frame);
    expect(dom.frame.isConnected).toBe(true);
    expect(dom.stats().detachedReads).toBe(0);
    expect(dom.written).toEqual(['<p>bootstrap</p>']);
    expect(dom.host.child).toBe(dom.frame);
    expect(dom.frame.style.cssText).toBe(EMULATOR_FRAME_STYLE);
    expect(dom.frame.attributes.title).toBe('PlayStation emulator');
    expect(dom.frame.attributes.allow).toContain('fullscreen');
    expect(dom.frame.src).toBe('about:blank');
  });

  it('appends to document.body when the canvas has no parent', () => {
    const dom = makeDom({ connectedCanvas: false });
    mountBootstrapFrame(dom.canvas as unknown as HTMLCanvasElement, '<p>x</p>');
    // With no parent element, the frame must be appended to document.body.
    expect(dom.body.children).toEqual([dom.frame]);
    expect(dom.frame.isConnected).toBe(true);
    expect(dom.written).toEqual(['<p>x</p>']);
  });

  it('restores the canvas and throws when no browsing context is available', () => {
    const dom = makeDom({ noContentDocument: true });
    expect(() =>
      mountBootstrapFrame(dom.canvas as unknown as HTMLCanvasElement, '<p>x</p>'),
    ).toThrow('Could not create the emulator frame');
    expect(dom.host.child).toBe(dom.canvas);
    expect(dom.frame.isConnected).toBe(false);
  });
});

describe('PlayStation bootstrap document', () => {
  const html = bootstrapHtml({
    gameName: 'A game',
    gameUrl: 'blob:https://example.test/abc',
    biosUrl: '',
    dataPath: '/cores/emulatorjs/data/',
    volume: 0.8,
    parentOrigin: 'https://example.test',
  });

  it('never posts status messages to a wildcard origin', () => {
    expect(html).not.toMatch(/postMessage\([^)]*,\s*'\*'\s*\)/);
    expect(html).toContain("var target = cfg.parentOrigin;");
    expect(html).toContain('"parentOrigin":"https://example.test"');
  });

  it('escapes injected markup so a game name cannot break out of the inline script', () => {
    const hostile = bootstrapHtml({
      gameName: '</script><img src=x onerror=alert(1)>',
      gameUrl: 'blob:x',
      biosUrl: '',
      dataPath: '/data/',
      volume: 1,
      parentOrigin: 'https://example.test',
    });
    expect(hostile).not.toContain('</script><img');
    // Every '<' in the JSON is emitted as a literal \u003c escape, so the
    // HTML parser never sees a closing </script> from a game name.
    expect(hostile).toContain(String.raw`\u003c/script>`);
    expect(hostile).not.toContain('</script><img');
  });

  it('loads the runtime at most once even if booted fires twice', () => {
    expect(html).toContain('var booted = false;');
    expect(html).toContain('if (booted) return;');
  });
});
