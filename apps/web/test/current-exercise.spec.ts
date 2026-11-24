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

  it('takes_the_exercise_of_the_newest_attempt_over_the_one_opened_last', () => {
    const older = { ...RACING, lastAttemptAt: '2026-11-18T10:00:00.000Z' };
    const newer = { ...BASICS, lastAttemptAt: '2026-11-19T10:00:00.000Z' };
    const third = exercise({ id: 'e0000000-0000-4000-8000-000000000003', activeReferenceId: null, referenceCount: 0, createdAt: '2026-11-20T10:00:00.000Z' });
    rememberExercise('user-2', third.id);
    expect(currentExercise([older, newer, third], 'user-2')).toBe(newer);
  });

  it('keeps_the_live_exercise_first', () => {
    const attempted = { ...BASICS, lastAttemptAt: '2026-11-19T10:00:00.000Z' };
    expect(currentExercise([RACING, attempted], 'user-3', RACING.id)).toBe(RACING);
  });

  it('falls_back_to_the_remembered_exercise_without_attempts', () => {
    rememberExercise('user-4', RACING.id);
    expect(currentExercise([RACING, BASICS], 'user-4')).toBe(RACING);
  });

  it('ignores_a_remembered_id_that_no_longer_exists', () => {
    rememberExercise('user-5', 'gone');
    expect(currentExercise([RACING, BASICS], 'user-5')).toBe(BASICS);
  });

  it('a_new_exercise_with_a_reference_and_no_attempt_wins_when_it_was_chosen_last', () => {
    const attempted = { ...RACING, lastAttemptAt: '2026-11-19T10:00:00.000Z' };
    const fresh = exercise({ id: 'e0000000-0000-4000-8000-000000000004', activeReferenceId: 'ref-new', lastAttemptAt: null });
    rememberExercise('user-6', fresh.id);
    expect(currentExercise([attempted, fresh], 'user-6')).toBe(fresh);
  });

  it('an_opened_exercise_without_a_reference_does_not_win', () => {
    const attempted = { ...RACING, lastAttemptAt: '2026-11-19T10:00:00.000Z' };
    const opened = exercise({ id: 'e0000000-0000-4000-8000-000000000005', activeReferenceId: null, referenceCount: 0, lastAttemptAt: null });
    rememberExercise('user-7', opened.id);
    expect(currentExercise([attempted, opened], 'user-7')).toBe(attempted);
  });
});
