export type Medal = 'bronze' | 'silver' | 'gold';

export type ExerciseStatus = 'new' | 'ready' | 'practising' | Medal;

export type MedalTargets = { bronzeMs?: number; silverMs?: number; goldMs?: number };

export type StatusInput = {
  hasActiveReference: boolean;
  completeAttempts: number;
  bestMs: number | null;
  targets: MedalTargets;
  manualMedal: Medal | null;
};

function medalForTime(bestMs: number, targets: MedalTargets): Medal | null {
  const meets = (target: number | undefined) => target !== undefined && bestMs <= target;
  if (meets(targets.goldMs)) return 'gold';
  if (meets(targets.silverMs)) return 'silver';
  if (meets(targets.bronzeMs)) return 'bronze';
  return null;
}

export function exerciseStatus(input: StatusInput): ExerciseStatus {
  if (input.manualMedal) return input.manualMedal;
  if (input.completeAttempts === 0) return input.hasActiveReference ? 'ready' : 'new';
  const medal = input.bestMs === null ? null : medalForTime(input.bestMs, input.targets);
  return medal ?? 'practising';
}
