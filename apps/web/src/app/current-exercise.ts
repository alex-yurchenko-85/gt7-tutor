import type { Exercise } from '@gt7/contracts';

function key(userId: string): string {
  return `gt7.currentExercise.${userId}`;
}

export function rememberedExerciseId(userId: string): string | null {
  try {
    return window.localStorage.getItem(key(userId));
  } catch {
    return null;
  }
}

export function rememberExercise(userId: string, exerciseId: string): void {
  try {
    window.localStorage.setItem(key(userId), exerciseId);
  } catch {
    return;
  }
}

export function currentExercise(exercises: Exercise[], userId: string): Exercise | null {
  const remembered = rememberedExerciseId(userId);
  const found = exercises.find(exercise => exercise.id === remembered);
  if (found) return found;
  return [...exercises].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}
