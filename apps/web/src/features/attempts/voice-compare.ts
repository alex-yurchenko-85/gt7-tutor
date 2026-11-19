import type { AttemptSummary } from '@gt7/contracts';

export type VoiceGroup = { medianMs: number | null; count: number };

export type VoiceComparison = { baseline: VoiceGroup; guided: VoiceGroup; changeMs: number | null };

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function group(attempts: AttemptSummary[], mode: AttemptSummary['mode']): VoiceGroup {
  const times = attempts.filter(attempt => attempt.mode === mode && attempt.completion === 'complete' && attempt.gameMs !== null).map(attempt => attempt.gameMs!);
  return { medianMs: median(times), count: times.length };
}

export function compareVoice(attempts: AttemptSummary[], referenceId: string | null): VoiceComparison {
  const compared = referenceId === null ? attempts : attempts.filter(attempt => attempt.referenceId === referenceId);
  const baseline = group(compared, 'baseline');
  const guided = group(compared, 'guided');
  const changeMs = baseline.medianMs === null || guided.medianMs === null ? null : guided.medianMs - baseline.medianMs;
  return { baseline, guided, changeMs };
}
