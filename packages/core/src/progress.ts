import type { ExerciseStatusName, ExerciseTargets, MedalName } from '@gt7/contracts';

export type StatusInput = {
  hasActiveReference: boolean;
  completeAttempts: number;
  bestMs: number | null;
  targets: ExerciseTargets;
};

function medalForTime(bestMs: number, targets: ExerciseTargets): MedalName | null {
  const meets = (target: number | undefined) => target !== undefined && bestMs <= target;
  if (meets(targets.goldMs)) return 'gold';
  if (meets(targets.silverMs)) return 'silver';
  if (meets(targets.bronzeMs)) return 'bronze';
  return null;
}

export function exerciseStatus(input: StatusInput): ExerciseStatusName {
  if (input.completeAttempts === 0) return input.hasActiveReference ? 'ready' : 'new';
  const medal = input.bestMs === null ? null : medalForTime(input.bestMs, input.targets);
  return medal ?? 'practising';
}
