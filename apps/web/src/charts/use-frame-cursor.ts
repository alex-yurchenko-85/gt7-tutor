import { useCallback, useEffect, useRef, useState } from 'react';

export function useFrameCursor(): [number, (sM: number) => void, (sM: number) => void] {
  const [cursorSM, setCursorSM] = useState(0);
  const frame = useRef<number | null>(null);
  const pending = useRef(0);
  const cancel = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);
  const setNow = useCallback(
    (sM: number) => {
      cancel();
      setCursorSM(sM);
    },
    [cancel]
  );
  const scrub = useCallback((sM: number) => {
    pending.current = sM;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setCursorSM(pending.current);
    });
  }, []);
  useEffect(() => cancel, [cancel]);
  return [cursorSM, setNow, scrub];
}
