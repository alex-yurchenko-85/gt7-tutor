import { describe, expect, it } from 'vitest';
import { currentExercise, liveExerciseId, rememberExercise } from '../src/app/current-exercise.ts';
import { exercise, EXERCISE_ID } from './fixtures.ts';
import { liveState } from './support.tsx';

const RACING = exercise({ id: EXERCISE_ID, createdAt: '2026-11-16T10:00:00.000Z' });
const BASICS = exercise({ id: 'e0000000-0000-4000-8000-000000000002', createdAt: '2026-11-17T10:00:00.000Z' });

describe('current exercise', () => {
  it('current_exercise_prefers_the_live_exercise', () => {
    rememberExercise('user-1', BASICS.id);
    expect(currentExercise([RACING, BASICS], 'user-1')).toBe(BASICS);
    expect(currentExercise([RACING, BASICS], 'user-1', RACING.id)).toBe(RACING);
    expect(currentExercise([BASICS], 'user-1', RACING.id)).toBe(BASICS);
  });

  it('live_exercise_only_while_a_training_runs', () => {
    for (const mode of ['armed', 'driving', 'paused', 'finished'] as const) {
      expect(liveExerciseId(liveState({ mode, exerciseId: RACING.id }))).toBe(RACING.id);
    }
    for (const mode of ['idle', 'capturing'] as const) {
      expect(liveExerciseId(liveState({ mode, exerciseId: RACING.id }))).toBeNull();
    }
    expect(liveExerciseId(null)).toBeNull();
  });
});
