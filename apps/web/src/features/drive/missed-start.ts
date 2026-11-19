import { useState } from 'react';
import type { LiveMode, LiveState } from '@gt7/contracts';

type Dismissal = { mode: LiveMode | null; dismissed: boolean };

export function useMissedStart(state: LiveState | null): { missed: boolean; dismiss(): void } {
  const mode = state?.mode ?? null;
  const [dismissal, setDismissal] = useState<Dismissal>({ mode, dismissed: false });
  if (dismissal.mode !== mode) setDismissal({ mode, dismissed: false });

  return {
    missed: (state?.startMissed ?? false) && dismissal.mode === mode && !dismissal.dismissed,
    dismiss: () => setDismissal(current => ({ ...current, dismissed: true }))
  };
}
