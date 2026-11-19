import type { Exercise, LiveState } from '@gt7/contracts';

const TRAINING_MODES: LiveState['mode'][] = ['armed', 'driving', 'paused', 'finished'];

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

const CURRENT_CHANGED = 'gt7:current-exercise-changed';

export function rememberExercise(userId: string, exerciseId: string): void {
  try {
    if (window.localStorage.getItem(key(userId)) === exerciseId) return;
    window.localStorage.setItem(key(userId), exerciseId);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CURRENT_CHANGED));
}

export function onCurrentExerciseChanged(listener: () => void): () => void {
  window.addEventListener(CURRENT_CHANGED, listener);
  return () => window.removeEventListener(CURRENT_CHANGED, listener);
}

export function liveExerciseId(state: LiveState | null): string | null {
  return state && TRAINING_MODES.includes(state.mode) ? state.exerciseId : null;
}

export function currentExercise(exercises: Exercise[], userId: string, liveId: string | null = null): Exercise | null {
  const live = exercises.find(exercise => exercise.id === liveId);
  if (live) return live;
  const remembered = rememberedExerciseId(userId);
  const found = exercises.find(exercise => exercise.id === remembered);
  if (found) return found;
  return [...exercises].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

export function forgetExercises(userId: string, exerciseIds: string[]): void {
  try {
    if (exerciseIds.includes(window.localStorage.getItem(key(userId)) ?? '')) window.localStorage.removeItem(key(userId));
  } catch {
    return;
  }
}

const EXERCISES_CHANGED = 'gt7:exercises-changed';

export function announceExercisesChanged(): void {
  window.dispatchEvent(new Event(EXERCISES_CHANGED));
}

export function onExercisesChanged(listener: () => void): () => void {
  window.addEventListener(EXERCISES_CHANGED, listener);
  return () => window.removeEventListener(EXERCISES_CHANGED, listener);
}
