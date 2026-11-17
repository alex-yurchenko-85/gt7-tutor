import { api } from '../../api/client.ts';
import { useResource } from '../../app/resource.ts';

export function useExercise(exerciseId: string) {
  return useResource(() => api.exercise(exerciseId), [exerciseId]);
}
