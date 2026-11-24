import type { AttemptList, FocusSummary } from '@gt7/contracts';

export function latestFocus(list: AttemptList | null | undefined, referenceId: string | null): FocusSummary | null {
  if (!list || referenceId === null) return null;
  const complete = list.days.flatMap(day => day.attempts).filter(attempt => attempt.referenceId === referenceId && attempt.completion === 'complete');
  const newest = complete.sort((a, b) => b.number - a.number)[0];
  return newest?.focus ?? null;
}
