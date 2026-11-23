import { api } from '../../api/client.ts';
import { useResource } from '../../app/resource.ts';
import { afterTargetSave } from './target-save.ts';

export function loadExercise(exerciseId: string) {
  return afterTargetSave().then(() => api.exercise(exerciseId));
}

export function useExercise(exerciseId: string) {
  return useResource(() => loadExercise(exerciseId), [exerciseId]);
}
