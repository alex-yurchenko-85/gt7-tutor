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

export type NextMedal = { medal: MedalName; targetMs: number; gapMs: number };

const MEDAL_ORDER: { medal: MedalName; target: keyof ExerciseTargets }[] = [
  { medal: 'bronze', target: 'bronzeMs' },
  { medal: 'silver', target: 'silverMs' },
  { medal: 'gold', target: 'goldMs' }
];

export function nextMedal(bestMs: number | null, targets: ExerciseTargets): NextMedal | null {
  if (bestMs === null) return null;
  for (const { medal, target } of MEDAL_ORDER) {
    const targetMs = targets[target];
    if (targetMs !== undefined && bestMs > targetMs) return { medal, targetMs, gapMs: bestMs - targetMs };
  }
  return null;
}

export function exerciseStatus(input: StatusInput): ExerciseStatusName {
  if (input.completeAttempts === 0) return input.hasActiveReference ? 'ready' : 'new';
  const medal = input.bestMs === null ? null : medalForTime(input.bestMs, input.targets);
  return medal ?? 'practising';
}
