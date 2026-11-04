import type { Keybindings } from '@/core/types';

/** Canonical logical buttons across engines. */
export type LogicalButton =
  | 'UP'
  | 'DOWN'
  | 'LEFT'
  | 'RIGHT'
  | 'A'
  | 'B'
  | 'X'
  | 'Y'
  | 'L'
  | 'R'
  | 'START'
  | 'SELECT'
  | 'L2'
  | 'R2'
  | 'L3'
  | 'R3';

export const DEFAULT_KEYBINDINGS: Keybindings = {
  UP: 'ArrowUp',
  DOWN: 'ArrowDown',
  LEFT: 'ArrowLeft',
  RIGHT: 'ArrowRight',
  A: 'KeyZ',
  B: 'KeyX',
  X: 'KeyA',
  Y: 'KeyS',
  L: 'KeyQ',
  R: 'KeyE',
  START: 'Enter',
  SELECT: 'ShiftRight',
  L2: 'KeyR',
  R2: 'KeyT',
  L3: 'KeyF',
  R3: 'KeyG',
};

/** Keyboard codes users cannot rebind (browser/system shortcuts). */
export const RESERVED_CODES = new Set([
  'F5',
  'F11',
  'F12',
  'Tab',
  'MetaLeft',
  'MetaRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
]);

/** Standard Gamepad API button index -> logical button (W3C layout). */
const GAMEPAD_STANDARD: Record<number, LogicalButton> = {
  0: 'B', // bottom face
  1: 'A', // right face
  2: 'Y', // left face
  3: 'X', // top face
  4: 'L',
  5: 'R',
  6: 'L2',
  7: 'R2',
  8: 'SELECT',
  9: 'START',
  10: 'L3',
  11: 'R3',
  12: 'UP',
  13: 'DOWN',
  14: 'LEFT',
  15: 'RIGHT',
};

/** GBA 10-button interface (mGBA names). */
export const GBA_BUTTONS = ['A', 'B', 'L', 'R', 'Start', 'Select', 'Up', 'Down', 'Left', 'Right'] as const;

export interface InputEvent {
  button: LogicalButton;
  pressed: boolean;
  source: 'keyboard' | 'gamepad' | 'touch';
}

export interface GamepadState {
  connected: boolean;
  id: string | null;
  axes: number[];
  pressed: Set<LogicalButton>;
}

/**
 * Keyboard source. Listens on window with capture so the player receives keys
 * before page shortcuts, and ignores events targeted at text inputs.
 */
export class KeyboardInput {
  private down = new Set<LogicalButton>();
  private bindings: Keybindings;
  private handler: (e: KeyboardEvent) => void;
  private listener: (event: InputEvent) => void;
  private enabled = true;

  constructor(
    bindings: Keybindings,
    listener: (event: InputEvent) => void,
    private target: Window = window,
    private shouldIgnore?: (target: EventTarget | null) => boolean,
  ) {
    this.bindings = { ...bindings };
    this.listener = listener;
    this.handler = (e: KeyboardEvent) => {
      if (!this.enabled) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (this.shouldIgnore?.(e.target)) return;
      const button = this.buttonFor(e.code);
      if (!button) return;
      if (e.repeat) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      const pressed = e.type === 'keydown';
      if (pressed && this.down.has(button)) return;
      if (!pressed && !this.down.has(button)) return;
      if (pressed) this.down.add(button);
      else this.down.delete(button);
      this.listener({ button, pressed, source: 'keyboard' });
    };
    this.target.addEventListener('keydown', this.handler, { capture: true });
    this.target.addEventListener('keyup', this.handler, { capture: true });
  }

  buttonFor(code: string): LogicalButton | null {
    for (const [button, bound] of Object.entries(this.bindings)) {
      if (bound === code) return button as LogicalButton;
    }
    return null;
  }

  setBindings(bindings: Keybindings): void {
    this.bindings = { ...bindings };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.releaseAll();
  }

  /** Release every held key — used on blur/fullscreen changes to avoid stuck inputs. */
  releaseAll(): void {
    for (const button of [...this.down]) {
      this.down.delete(button);
      this.listener({ button, pressed: false, source: 'keyboard' });
    }
  }

  destroy(): void {
    this.target.removeEventListener('keydown', this.handler, { capture: true });
    this.target.removeEventListener('keyup', this.handler, { capture: true });
    this.releaseAll();
  }
}

/** Gamepad polling with a deadzone; reports edges only. */
export class GamepadInput {
  private pressed = new Set<LogicalButton>();

  constructor(
    private listener: (event: InputEvent) => void,
    private deadzone = 0.35,
  ) {}

  get state(): GamepadState {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p): p is Gamepad => Boolean(p && p.connected)) ?? null;
    return {
      connected: Boolean(pad),
      id: pad?.id ?? null,
      axes: pad ? [pad.axes[0] ?? 0, pad.axes[1] ?? 0] : [],
      pressed: new Set(this.pressed),
    };
  }

  poll(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p): p is Gamepad => Boolean(p && p.connected));
    if (!pad) {
      if (this.pressed.size) this.releaseAll();
      return;
    }
    const now = new Set<LogicalButton>();
    pad.buttons.forEach((btn, index) => {
      const logical = GAMEPAD_STANDARD[index];
      if (logical && btn.pressed) now.add(logical);
    });
    const x = pad.axes[0] ?? 0;
    const y = pad.axes[1] ?? 0;
    if (x < -this.deadzone) now.add('LEFT');
    if (x > this.deadzone) now.add('RIGHT');
    if (y < -this.deadzone) now.add('UP');
    if (y > this.deadzone) now.add('DOWN');

    for (const button of now) {
      if (!this.pressed.has(button)) this.listener({ button, pressed: true, source: 'gamepad' });
    }
    for (const button of this.pressed) {
      if (!now.has(button)) this.listener({ button, pressed: false, source: 'gamepad' });
    }
    this.pressed = now;
  }

  releaseAll(): void {
    for (const button of this.pressed) this.listener({ button, pressed: false, source: 'gamepad' });
    this.pressed.clear();
  }
}
