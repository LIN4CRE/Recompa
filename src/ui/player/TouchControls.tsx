import { useRef, useState } from 'react';
import { clsx } from 'clsx';
import type { LogicalButton } from '@/engines/input';

/**
 * Touch controls.
 *
 * Layout is a two-handed gamepad: D-pad bottom-left, face buttons bottom-right,
 * with Start/Select centred. Each control is a real `<button>` so screen readers
 * and switch access work; `pointerdown/up/cancel/leave` map to button edges.
 *
 * Multi-touch matters: pressing right while holding jump must not release jump,
 * so we track pointerId per control and never rely on a single "active" state.
 */
export function TouchControls({
  buttons,
  onInput,
  layout = 'landscape',
}: {
  buttons: LogicalButton[];
  onInput: (button: LogicalButton, pressed: boolean) => void;
  layout?: 'landscape' | 'portrait';
}) {
  const pad = (button: LogicalButton) => <TouchButton key={button} button={button} label={labelFor(button)} onInput={onInput} />;

  const faceOrder: LogicalButton[] = ['B', 'A', 'Y', 'X'];
  const faces = buttons.filter((b) => faceOrder.includes(b));
  const shoulders = buttons.filter((b) => b === 'L' || b === 'R');
  const dpset = buttons.filter((b) => ['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(b));
  const system = buttons.filter((b) => b === 'START' || b === 'SELECT');

  return (
    <div
      className={clsx(
        'pointer-events-none select-none',
        layout === 'landscape' ? 'fixed inset-x-0 bottom-0 z-30' : 'relative',
      )}
      aria-label="Touch controls"
    >
      <div className="pointer-events-auto mx-auto flex w-full max-w-4xl items-end justify-between gap-4 px-3 pb-3">
        {/* D-pad */}
        <div className="relative size-[150px] shrink-0">
          <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-1">
            <span />
            {dpset.includes('UP') && pad('UP')}
            <span />
            {dpset.includes('LEFT') && pad('LEFT')}
            <div className="grid place-items-center rounded-md bg-white/4">
              <span className="size-2 rounded-full bg-white/15" />
            </div>
            {dpset.includes('RIGHT') && pad('RIGHT')}
            <span />
            {dpset.includes('DOWN') && pad('DOWN')}
            <span />
          </div>
        </div>

        {/* System + shoulders */}
        <div className="mb-2 flex flex-col items-center gap-2">
          {shoulders.length > 0 && (
            <div className="flex gap-2">
              {shoulders.map((b) => (
                <TouchButton key={b} button={b} label={labelFor(b)} onInput={onInput} wide />
              ))}
            </div>
          )}
          <div className="flex gap-2">
            {system.map((b) => (
              <TouchButton key={b} button={b} label={labelFor(b)} onInput={onInput} wide />
            ))}
          </div>
        </div>

        {/* Face buttons */}
        <div className="relative size-[150px] shrink-0">
          {faces.includes('X') && (
            <div className="absolute top-0 left-1/2 -translate-x-1/2">
              <TouchButton button="X" label="X" onInput={onInput} round />
            </div>
          )}
          {faces.includes('Y') && (
            <div className="absolute top-1/2 left-0 -translate-y-1/2">
              <TouchButton button="Y" label="Y" onInput={onInput} round />
            </div>
          )}
          {faces.includes('B') && (
            <div className="absolute top-1/2 right-0 -translate-y-1/2">
              <TouchButton button="B" label="B" onInput={onInput} round />
            </div>
          )}
          {faces.includes('A') && (
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
              <TouchButton button="A" label="A" onInput={onInput} round />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function labelFor(button: LogicalButton): string {
  switch (button) {
    case 'START':
      return 'START';
    case 'SELECT':
      return 'SELECT';
    case 'UP':
      return '▲';
    case 'DOWN':
      return '▼';
    case 'LEFT':
      return '◀';
    case 'RIGHT':
      return '▶';
    default:
      return button;
  }
}

function TouchButton({
  button,
  label,
  onInput,
  round = false,
  wide = false,
}: {
  button: LogicalButton;
  label: string;
  onInput: (button: LogicalButton, pressed: boolean) => void;
  round?: boolean;
  wide?: boolean;
}) {
  const [active, setActive] = useState(false);
  const pointerRef = useRef<number | null>(null);
  const isDpad = ['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(button);

  const press = (event: React.PointerEvent) => {
    if (pointerRef.current !== null) return;
    pointerRef.current = event.pointerId;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    setActive(true);
    onInput(button, true);
  };
  const release = (event: React.PointerEvent) => {
    if (pointerRef.current !== event.pointerId) return;
    pointerRef.current = null;
    setActive(false);
    onInput(button, false);
  };

  return (
    <button
      type="button"
      aria-label={button}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={(event) => {
        // Only release on leave for mouse; touch capture keeps the press alive
        // until the finger lifts, which is what players expect.
        if (event.pointerType === 'mouse') release(event);
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={clsx(
        'touch-none border backdrop-blur-sm transition-[transform,background-color,border-color] duration-75',
        'flex items-center justify-center font-mono text-[11px] font-semibold tracking-wider',
        active ? 'scale-95 border-lime/70 bg-lime/25 text-white' : 'border-white/18 bg-black/35 text-white/80',
        round && 'size-14 rounded-full',
        wide && 'h-9 min-w-14 rounded-md px-2 text-[10px]',
        isDpad && 'size-full rounded-md',
      )}
    >
      {label}
    </button>
  );
}
