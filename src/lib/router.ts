import { useCallback, useEffect, useState } from 'react';

/**
 * Minimal hash router.
 *
 * Hash routing (not History API) because Recompa is deployed as a static bundle
 * on arbitrary hosts/CDNs and deep links must work without server rewrites.
 */

export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [pathname, search = ''] = raw.split('?');
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return {
    path,
    segments: path.split('/').filter(Boolean),
    query: new URLSearchParams(search),
  };
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const target = to.startsWith('#') ? to : `#${to.startsWith('/') ? to : `/${to}`}`;
  if (opts.replace) {
    window.location.replace(target);
  } else if (window.location.hash !== target) {
    window.location.hash = target;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function useNavigate(): (to: string) => void {
  return useCallback((to: string) => navigate(to), []);
}
