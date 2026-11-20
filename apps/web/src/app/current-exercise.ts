import type { Exercise, LiveState } from '@gt7/contracts';
import { readStored, writeStored } from './storage.ts';

export const TRAINING_MODES: LiveState['mode'][] = ['armed', 'driving', 'paused', 'finished'];

function key(userId: string): string {
  return `gt7.currentExercise.${userId}`;
}

export function rememberedExerciseId(userId: string): string | null {
  return readStored(key(userId));
}

const CURRENT_CHANGED = 'gt7:current-exercise-changed';

export function rememberExercise(userId: string, exerciseId: string): void {
  if (readStored(key(userId)) === exerciseId) return;
  writeStored(key(userId), exerciseId);
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
  if (exerciseIds.includes(readStored(key(userId)) ?? '')) writeStored(key(userId), null);
}

const EXERCISES_CHANGED = 'gt7:exercises-changed';

export function announceExercisesChanged(): void {
  window.dispatchEvent(new Event(EXERCISES_CHANGED));
}

export function onExercisesChanged(listener: () => void): () => void {
  window.addEventListener(EXERCISES_CHANGED, listener);
  return () => window.removeEventListener(EXERCISES_CHANGED, listener);
}
