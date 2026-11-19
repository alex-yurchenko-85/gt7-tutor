import { describe, expect, it } from 'vitest';
import { armTrainingSchema } from '../src/live.ts';

const exerciseId = '3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b';

describe('armTrainingSchema', () => {
  it('arm_request_needs_only_the_exercise_id', () => {
    expect(armTrainingSchema.parse({ exerciseId })).toEqual({ exerciseId });
  });

  it('arm_request_rejects_a_mode_key', () => {
    expect(armTrainingSchema.safeParse({ exerciseId, mode: 'guided' }).success).toBe(false);
    expect(armTrainingSchema.safeParse({ exerciseId, confirmNoVoice: true }).success).toBe(false);
  });
});
