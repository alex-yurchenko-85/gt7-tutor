import { CUE_WORDS, type CornerInfo, type LiveCue, type LiveGuidance, type LiveState, type ReferenceCue, type WordedCueKind } from '@gt7/contracts';

export type CueWords = { words: string; number: string | null };

export function shownOnDrive(cue: LiveCue | null): cue is LiveCue & { kind: WordedCueKind } {
  return cue !== null && cue.kind !== 'focus';
}

export function cueWords(cue: LiveCue & { kind: WordedCueKind }): CueWords {
  return { words: CUE_WORDS[cue.kind], number: cue.targetSpeedKph === null ? null : String(cue.targetSpeedKph) };
}

export function guidanceText(guidance: LiveGuidance): string | null {
  if (guidance.mode === 'active') return null;
  if (guidance.mode === 'waiting-for-restart') return 'Guidance stopped for this attempt. Restart the attempt to get cues again.';
  switch (guidance.reason) {
    case 'untrusted-position':
      return 'Guidance paused: your position is too far from the reference line.';
    case 'target-incompatible':
      return 'Guidance paused: the next target does not fit your speed here.';
    default:
      return 'Guidance paused.';
  }
}

export function connectionProblem(state: LiveState, socketConnected: boolean, demo = false): string | null {
  if (!socketConnected) return 'Connection to GT7 Tutor lost. Cues are not shown until it returns.';
  if (state.connection === 'disconnected') {
    return demo
      ? 'The demo attempt has ended. Select Stop training, then Play a demo attempt again.'
      : 'No packets from the console. Check that GT7 is running and that the address in Setup is right.';
  }
  if (state.connection === 'stale') return demo ? 'Waiting for the recorded data.' : 'Waiting for packets from the console.';
  return null;
}


export function spokenCues(cues: ReferenceCue[]): ReferenceCue[] {
  return cues.filter(cue => !cue.muted && cue.phrase !== null).sort((a, b) => a.sM - b.sM);
}

export function cueNote(cue: LiveCue, spoken: ReferenceCue[], corners: CornerInfo[]): string | null {
  const index = spoken.findIndex(item => item.key === cue.eventKey);
  const reference = spoken[index];
  if (!reference) return null;
  const turn = corners.find(corner => reference.sM < corner.zoneToSM);
  return `Cue ${index + 1} of ${spoken.length}${turn ? ` · before T${turn.number}` : ''}`;
}

export function nextCueProgress(sM: number, inM: number, spoken: ReferenceCue[]): number {
  const from = spoken.filter(cue => cue.sM <= sM).at(-1)?.sM ?? 0;
  const to = sM + inM;
  if (to <= from) return 1;
  return Math.min(1, Math.max(0, (sM - from) / (to - from)));
}
