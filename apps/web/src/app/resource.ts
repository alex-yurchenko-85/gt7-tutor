import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export type Resource<T> = { data: T | null; error: Error | null; loading: boolean; reload(): void };

function sameInputs(a: DependencyList, b: DependencyList): boolean {
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

export function useResource<T>(load: () => Promise<T>, deps: DependencyList): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const loadedFor = useRef<DependencyList>(deps);
  const changedInputs = !sameInputs(loadedFor.current, deps);
  useEffect(() => {
    let current = true;
    if (!sameInputs(loadedFor.current, deps)) {
      loadedFor.current = deps;
      setData(null);
      setError(null);
    }
    setLoading(true);
    load().then(
      value => {
        if (!current) return;
        setData(value);
        setError(null);
        setLoading(false);
      },
      (reason: unknown) => {
        if (!current) return;
        setError(reason instanceof Error ? reason : new Error(String(reason)));
        setLoading(false);
      }
    );
    return () => {
      current = false;
    };
  }, [...deps, version]);
  const reload = useCallback(() => setVersion(value => value + 1), []);
  return changedInputs ? { data: null, error: null, loading: true, reload } : { data, error, loading, reload };
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
