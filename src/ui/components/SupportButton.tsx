import { clsx } from 'clsx';

/**
 * Developer support link.
 *
 * A plain anchor, deliberately: no donation SDK, no iframe, no tracking. It
 * opens PayPal.me in a new tab with `noopener noreferrer`, so the destination
 * gets no handle on this window. Recompa never touches payment details — the
 * entire transaction happens on PayPal's own site, and the link proves nothing
 * about whether anyone donated.
 */

export const SUPPORT_URL = 'https://paypal.me/dlinacre16';

export function SupportButton({ compact = false }: { compact?: boolean }) {
  return (
    <a
      href={SUPPORT_URL}
      target="_blank"
      rel="noopener noreferrer"
      // Screen readers get the full intent; sighted users get the short label.
      aria-label="Buy Me a Smoke — support independent development by opening PayPal in a new tab"
      className={clsx(
        'group flex items-center gap-2 rounded-lg border transition-colors',
        'border-amber-400/25 bg-amber-400/[0.07] text-amber-200',
        'hover:border-amber-400/50 hover:bg-amber-400/[0.12]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400/60',
        compact ? 'px-2.5 py-1.5 text-[11px]' : 'px-3 py-2 text-xs',
      )}
    >
      <span aria-hidden className="text-sm leading-none">
        🚬
      </span>
      <span className="font-medium whitespace-nowrap">Buy Me a Smoke</span>
      {!compact && (
        <span className="hidden text-[10px] text-amber-200/60 group-hover:text-amber-200/80 sm:inline">
          optional
        </span>
      )}
    </a>
  );
}
