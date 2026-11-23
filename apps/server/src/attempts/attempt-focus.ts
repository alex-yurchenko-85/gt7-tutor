import type { FocusSummary } from '@gt7/contracts';
import type { Focus } from '@gt7/core';

export type FocusScope = { exerciseId: string; referenceId: string };

export function focusSummary(focus: Focus | null): FocusSummary | null {
  return focus ? { turn: focus.turn, part: focus.part, cause: focus.cause, clip: focus.clip } : null;
}
