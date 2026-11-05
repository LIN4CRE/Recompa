import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Top-level render-error boundary.
 *
 * Recompa has no server: if a component throws while rendering, there is nobody
 * to serve a friendly page and React's default behaviour is to unmount the whole
 * tree, leaving a blank screen with no way back. The most likely causes are all
 * local — a corrupt IndexedDB record written by an older build, an engine adapter
 * throwing while the player mounts, or a browser API returning an unexpected
 * shape. A reload usually fixes the first (the bad record is skipped or deleted)
 * and always resets the third, so the boundary offers exactly that plus the
 * error text the user can quote in a bug report.
 *
 * It deliberately does not try to "recover" by re-rendering the same tree.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; info: ErrorInfo | null }
> {
  state: { error: Error | null; info: ErrorInfo | null } = { error: null, info: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info });
    // Console only. There is no telemetry endpoint and nothing leaves the device.
    console.error('[recompa] render error', error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  private goHome = () => {
    window.location.hash = '#/';
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <div className="app-backdrop" aria-hidden />
        <div className="panel max-w-lg p-5">
          <p className="mono-label text-rose">Runtime error</p>
          <h1 className="mt-1 font-display text-xl font-bold tracking-tight">Recompa hit an error it could not render</h1>
          <p className="mt-2 text-xs leading-relaxed text-ink-3">
            Nothing was uploaded anywhere — the app runs entirely in this tab. A reload is usually enough; if it keeps happening,
            the message below is the whole diagnosis.
          </p>
          <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-line bg-black/40 p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-ink-3">
            {error.name}: {error.message}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-primary btn-sm" onClick={this.reload}>
              Reload
            </button>
            <button className="btn btn-sm" onClick={this.goHome}>
              Go to home screen
            </button>
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-ink-4">
            Your library lives in this browser's IndexedDB, so a reload does not lose stored games.
          </p>
        </div>
      </div>
    );
  }
}
