import type { CuePreview, PreviewCue, PreviewDrop } from '@gt7/contracts';
import { counted } from '../../app/plural.ts';

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
    if (before === null) return 'The voice still says another phrase here.';
    return `The voice still says cue ${before} here. Mute cue ${before} or this cue, or move cue ${before} earlier.`;
  }
  if (drop.reason === 'too-late') return 'There is no time to say this cue here on the reference line.';
  if (drop.reason === 'already-done') return 'The car of the reference already does this here, so the voice does not say it.';
  return 'The voice does not say this cue on the reference line.';
}

export function notSpokenSummary(count: number): string {
  return `${counted(count, 'cue')} ${count === 1 ? 'is' : 'are'} not spoken on the reference line.`;
}

function muteKeyOf(cue: PreviewCue): string | null {
  if (cue.rowKey !== null) return cue.rowKey;
  return cue.key.startsWith('big-stop@') ? `brake@${cue.key.slice('big-stop@'.length)}` : null;
}

export function withoutMuted(preview: CuePreview, muted: string[]): CuePreview {
  return { ...preview, cues: preview.cues.filter(cue => !muted.includes(muteKeyOf(cue) ?? '')) };
}

export function previewClips(preview: CuePreview): string[] {
  return [...new Set(preview.cues.flatMap(cue => (cue.followClip ? [cue.clip, cue.followClip] : [cue.clip])))];
}

