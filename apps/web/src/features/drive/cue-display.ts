import type { CornerInfo, LiveCue, LiveGuidance, LiveState, ReferenceCue, WordedCueKind } from '@gt7/contracts';
import { t } from '../../app/i18n.ts';

export type CueWords = { words: string; number: string | null };

export function shownOnDrive(cue: LiveCue | null): cue is LiveCue & { kind: WordedCueKind } {
  return cue !== null && cue.kind !== 'focus';
}

export function cueWords(cue: LiveCue & { kind: WordedCueKind }): CueWords {
  return { words: t(`drive.cue.${cue.kind}`), number: cue.targetSpeedKph === null ? null : String(cue.targetSpeedKph) };
}

export function guidanceText(guidance: LiveGuidance): string | null {
  if (guidance.mode === 'active') return null;
  if (guidance.mode === 'waiting-for-restart') return t('drive.guidance.stopped');
  switch (guidance.reason) {
    case 'untrusted-position':
      return t('drive.guidance.untrusted-position');
    case 'target-incompatible':
      return t('drive.guidance.target-incompatible');
    default:
      return t('drive.guidance.paused');
  }
}

export function connectionProblem(state: LiveState, socketConnected: boolean, demo = false): string | null {
  if (!socketConnected) return t('drive.connection.lost');
  if (state.connection === 'disconnected') {
    return demo
      ? t('drive.connection.demo-ended')
      : t('drive.connection.no-packets');
  }
  if (state.connection === 'stale') return demo ? t('drive.connection.demo-waiting') : t('drive.connection.waiting');
  return null;
}


export function spokenCues(cues: ReferenceCue[]): ReferenceCue[] {
  return cues.filter(cue => !cue.muted && cue.phraseClips !== null).sort((a, b) => a.sM - b.sM);
}

export function cueNote(cue: LiveCue, spoken: ReferenceCue[], corners: CornerInfo[]): string | null {
  const index = spoken.findIndex(item => item.key === cue.eventKey);
  const reference = spoken[index];
  if (!reference) return null;
  const turn = corners.find(corner => reference.sM < corner.zoneToSM);
  const place = { number: index + 1, total: spoken.length };
  return turn ? t('drive.cue-note-turn', { ...place, turn: turn.number }) : t('drive.cue-note', place);
}
