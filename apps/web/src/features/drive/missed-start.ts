import { useEffect, useState } from 'react';
import type { LiveMode, LiveState } from '@gt7/contracts';

export const MISSED_START_AFTER_MS = 10000;
export const MOVING_KPH = 10;

type Prompt = { mode: LiveMode | null; missed: boolean; dismissed: boolean };

export function useMissedStart(state: LiveState | null): { missed: boolean; dismiss(): void } {
  const mode = state?.mode ?? null;
  const moving = mode === 'armed' && (state?.speedKph ?? 0) >= MOVING_KPH;
  const [prompt, setPrompt] = useState<Prompt>({ mode, missed: false, dismissed: false });
  if (prompt.mode !== mode) setPrompt({ mode, missed: false, dismissed: false });

  useEffect(() => {
    if (!moving) return;
    const timer = setTimeout(() => setPrompt(current => (current.mode === 'armed' ? { ...current, missed: true } : current)), MISSED_START_AFTER_MS);
    return () => clearTimeout(timer);
  }, [moving]);

  return {
    missed: prompt.mode === mode && mode === 'armed' && prompt.missed && !prompt.dismissed,
    dismiss: () => setPrompt(current => ({ ...current, dismissed: true }))
  };
}
