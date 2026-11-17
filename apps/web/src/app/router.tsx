import { createContext, useCallback, useContext, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';

export type Route =
  | { name: 'now' }
  | { name: 'catalogue' }
  | { name: 'drive' }
  | { name: 'progress' }
  | { name: 'setup' }
  | { name: 'cues'; exerciseId: string }
  | { name: 'references'; exerciseId: string }
  | { name: 'record'; exerciseId: string }
  | { name: 'attempts'; exerciseId: string }
  | { name: 'review'; attemptId: string }
  | { name: 'not-found' };

const SIMPLE: Record<string, Route> = {
  '/': { name: 'now' },
  '/catalogue': { name: 'catalogue' },
  '/drive': { name: 'drive' },
  '/progress': { name: 'progress' },
  '/setup': { name: 'setup' }
};

const EXERCISE_VIEWS = ['cues', 'references', 'record', 'attempts'] as const;

export function parseRoute(path: string): Route {
  const clean = path.replace(/\/+$/, '') || '/';
  const simple = SIMPLE[clean];
  if (simple) return simple;
  const exercise = /^\/exercises\/([^/]+)\/([a-z]+)$/.exec(clean);
  const view = EXERCISE_VIEWS.find(name => name === exercise?.[2]);
  if (exercise && view) return { name: view, exerciseId: decodeURIComponent(exercise[1]!) };
  const review = /^\/attempts\/([^/]+)\/review$/.exec(clean);
  if (review) return { name: 'review', attemptId: decodeURIComponent(review[1]!) };
  return { name: 'not-found' };
}

export const paths = {
  now: () => '/',
  catalogue: () => '/catalogue',
  drive: () => '/drive',
  progress: () => '/progress',
  setup: () => '/setup',
  cues: (exerciseId: string) => `/exercises/${encodeURIComponent(exerciseId)}/cues`,
  references: (exerciseId: string) => `/exercises/${encodeURIComponent(exerciseId)}/references`,
  record: (exerciseId: string) => `/exercises/${encodeURIComponent(exerciseId)}/record`,
  attempts: (exerciseId: string) => `/exercises/${encodeURIComponent(exerciseId)}/attempts`,
  review: (attemptId: string, referenceId?: string) =>
    `/attempts/${encodeURIComponent(attemptId)}/review${referenceId ? `?reference=${encodeURIComponent(referenceId)}` : ''}`
};

type Navigation = { route: Route; search: URLSearchParams; navigate(path: string): void };

const RouterContext = createContext<Navigation | null>(null);

function currentLocation() {
  return { route: parseRoute(window.location.pathname), search: new URLSearchParams(window.location.search) };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(currentLocation);
  useEffect(() => {
    const onPop = () => setLocation(currentLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((path: string) => {
    window.history.pushState(null, '', path);
    setLocation(currentLocation());
    window.scrollTo?.(0, 0);
  }, []);
  const value = useMemo(() => ({ ...location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): Navigation {
  const navigation = useContext(RouterContext);
  if (!navigation) throw new Error('useRouter needs a RouterProvider');
  return navigation;
}

type LinkProps = { to: string; children: ReactNode; className?: string; current?: boolean; primary?: boolean; onNavigate?: () => void };

export function Link({ to, children, className, current, primary, onNavigate }: LinkProps) {
  const { navigate } = useRouter();
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate?.();
    navigate(to);
  };
  return (
    <a href={to} className={className} aria-current={current ? 'page' : undefined} data-primary={primary ? 'true' : undefined} onClick={follow}>
      {children}
    </a>
  );
}
