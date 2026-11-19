import { createContext, useCallback, useContext, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';

export type SetupSection = 'console' | 'voice' | 'profiles' | 'preferences' | 'catalogue' | 'data';

export type Route =
  | { name: 'exercises' }
  | { name: 'exercise'; exerciseId: string }
  | { name: 'add-exercise' }
  | { name: 'drive' }
  | { name: 'setup' }
  | { name: 'delete-history' }
  | { name: 'cues'; exerciseId: string }
  | { name: 'references'; exerciseId: string }
  | { name: 'record'; exerciseId: string }
  | { name: 'attempts'; exerciseId: string }
  | { name: 'review'; attemptId: string }
  | { name: 'not-found' };

const SIMPLE: Record<string, Route> = {
  '/': { name: 'exercises' },
  '/exercises/add': { name: 'add-exercise' },
  '/drive': { name: 'drive' },
  '/setup': { name: 'setup' },
  '/setup/delete-history': { name: 'delete-history' }
};

const EXERCISE_VIEWS = ['cues', 'references', 'record', 'attempts'] as const;

function cleanPath(path: string): string {
  return path.replace(/\/+$/, '') || '/';
}

export function parseRoute(path: string): Route {
  const clean = cleanPath(path);
  const simple = SIMPLE[clean];
  if (simple) return simple;
  const page = /^\/exercises\/([^/]+)$/.exec(clean);
  if (page) return { name: 'exercise', exerciseId: decodeURIComponent(page[1]!) };
  const exercise = /^\/exercises\/([^/]+)\/([a-z]+)$/.exec(clean);
  const view = EXERCISE_VIEWS.find(name => name === exercise?.[2]);
  if (exercise && view) return { name: view, exerciseId: decodeURIComponent(exercise[1]!) };
  const review = /^\/attempts\/([^/]+)\/review$/.exec(clean);
  if (review) return { name: 'review', attemptId: decodeURIComponent(review[1]!) };
  return { name: 'not-found' };
}

export const paths = {
  exercises: () => '/',
  exercise: (exerciseId: string) => `/exercises/${encodeURIComponent(exerciseId)}`,
  addExercise: () => '/exercises/add',
  drive: () => '/drive',
  setup: (section?: SetupSection) => (section ? `/setup#${section}` : '/setup'),
  deleteHistory: () => '/setup/delete-history',
  cues: (exerciseId: string) => `/exercises/${encodeURIComponent(exerciseId)}/cues`,
  references: (exerciseId: string) => `/exercises/${encodeURIComponent(exerciseId)}/references`,
  record: (exerciseId: string) => `/exercises/${encodeURIComponent(exerciseId)}/record`,
  attempts: (exerciseId: string) => `/exercises/${encodeURIComponent(exerciseId)}/attempts`,
  review: (attemptId: string, referenceId?: string) =>
    `/attempts/${encodeURIComponent(attemptId)}/review${referenceId ? `?reference=${encodeURIComponent(referenceId)}` : ''}`
};

type NavigateOptions = { replace?: boolean };

type Navigation = { route: Route; search: URLSearchParams; hash: string; navigate(path: string, options?: NavigateOptions): void };

const RouterContext = createContext<Navigation | null>(null);

function currentLocation() {
  return { route: parseRoute(window.location.pathname), search: new URLSearchParams(window.location.search), hash: window.location.hash.slice(1) };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(currentLocation);
  useEffect(() => {
    const onPop = () => setLocation(currentLocation());
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    };
  }, []);
  const navigate = useCallback((path: string, options: NavigateOptions = {}) => {
    if (options.replace) window.history.replaceState(null, '', path);
    else window.history.pushState(null, '', path);
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

type LinkProps = {
  to: string;
  children: ReactNode;
  className?: string;
  current?: boolean;
  primary?: boolean;
  onNavigate?: () => void;
  role?: 'menuitem';
  label?: string;
};

export function Link({ to, children, className, current, primary, onNavigate, role, label }: LinkProps) {
  const { navigate } = useRouter();
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate?.();
    navigate(to);
  };
  return (
    <a
      href={to}
      className={className}
      role={role}
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      data-primary={primary ? 'true' : undefined}
      onClick={follow}
    >
      {children}
    </a>
  );
}
