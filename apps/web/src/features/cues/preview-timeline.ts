import type { CuePreview, PreviewCue, PreviewDrop } from '@gt7/contracts';
import { t } from '../../app/i18n.ts';

export function previewPositionM(preview: CuePreview, elapsedMs: number): number {
  const times = preview.gridTimeMs;
  if (times.length === 0 || elapsedMs <= times[0]!) return 0;
  const last = times.length - 1;
  if (elapsedMs >= times[last]!) return last * preview.gridM;
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (times[middle]! <= elapsedMs) low = middle;
    else high = middle;
  }
  const span = times[high]! - times[low]!;
  const share = span > 0 ? (elapsedMs - times[low]!) / span : 0;
  return (low + share) * preview.gridM;
}

export function cuesDue(preview: CuePreview, afterMs: number, untilMs: number): PreviewCue[] {
  return preview.cues.filter(cue => cue.atMs > afterMs && cue.atMs <= untilMs).sort((a, b) => a.atMs - b.atMs);
}

export function notSpokenText(drop: PreviewDrop, numberOf: (rowKey: string) => number | null): string {
  if (drop.reason === 'voice-busy') {
    const before = drop.afterRowKey === null ? null : numberOf(drop.afterRowKey);
    if (before === null) return t('exercises.preview.voice-busy');
    return t('exercises.preview.voice-busy-cue', { number: before });
  }
  if (drop.reason === 'too-late') return t('exercises.preview.too-late');
  if (drop.reason === 'already-done') return t('exercises.preview.already-done');
  return t('exercises.preview.not-said');
}

export function notSpokenSummary(count: number): string {
  return t('exercises.preview.not-spoken', { count });
}

export function previewClips(preview: CuePreview): string[] {
  return [...new Set(preview.cues.flatMap(cue => (cue.followClip ? [cue.clip, cue.followClip] : [cue.clip])))];
}

