import { median, type AttemptSummary } from '@gt7/contracts';

export type VoiceGroup = { medianMs: number | null; count: number };

export type VoiceComparison = { baseline: VoiceGroup; guided: VoiceGroup; changeMs: number | null };

function group(attempts: AttemptSummary[], mode: AttemptSummary['mode']): VoiceGroup {
  const times = attempts.filter(attempt => attempt.mode === mode && attempt.completion === 'complete' && attempt.timeMs !== null).map(attempt => attempt.timeMs!);
  return { medianMs: median(times), count: times.length };
}

export function compareVoice(attempts: AttemptSummary[], referenceId: string | null): VoiceComparison {
  const compared = referenceId === null ? attempts : attempts.filter(attempt => attempt.referenceId === referenceId);
  const baseline = group(compared, 'baseline');
  const guided = group(compared, 'guided');
  const changeMs = baseline.medianMs === null || guided.medianMs === null ? null : guided.medianMs - baseline.medianMs;
  return { baseline, guided, changeMs };
}
