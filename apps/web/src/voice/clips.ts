import type { ReferenceCue } from '@gt7/contracts';
import { clipOf, followClipOf } from '../features/cues/cue-format.ts';

const SIDE_CLIPS = ['keep-left', 'keep-right'];
const GUIDANCE_CLIPS = ['guidance-paused', 'guidance-resumed'];
const FOCUS_KINDS = ['brake-early', 'brake-late', 'slow-corner', 'throttle-late', 'off-line', 'wide-apex'];
const MAX_SPOKEN_TURN = 10;

function focusClips(cornerCount: number): string[] {
  const turns = Array.from({ length: Math.min(MAX_SPOKEN_TURN, cornerCount) }, (_, index) => index + 1);
  return FOCUS_KINDS.flatMap(kind => turns.map(turn => `focus-${kind}-${turn}`));
}

export function clipsForCues(cues: ReferenceCue[], cornerCount: number): string[] {
  const actions = cues.flatMap(cue => {
    const follow = followClipOf(cue, true);
    return follow ? [clipOf(cue), follow] : [clipOf(cue)];
  });
  const bigStop = cues.some(cue => cue.bigStop) ? ['big-stop'] : [];
  const tighter = cornerCount > 0 ? ['tighter'] : [];
  return [...new Set([...actions, ...bigStop, ...tighter, ...SIDE_CLIPS, ...GUIDANCE_CLIPS, ...focusClips(cornerCount)])];
}
