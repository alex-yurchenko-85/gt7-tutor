import { useEffect, useState } from 'react';

export const WIDE_QUERY = '(min-width: 900px)';

function matches(): boolean {
  return typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_QUERY).matches : true;
}

export function useWideLayout(): boolean {
  const [wide, setWide] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(WIDE_QUERY);
    const onChange = () => setWide(query.matches);
    query.addEventListener('change', onChange);
    onChange();
    return () => query.removeEventListener('change', onChange);
  }, []);
  return wide;
}
