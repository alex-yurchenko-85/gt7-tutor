import { describe, expect, it } from 'vitest';
import type { LiveCue } from '@gt7/contracts';
import { SeenCues } from '../src/features/drive/seen-cues.ts';

function cue(id: string, generation: number): LiveCue {
  return { id, eventKey: 'brake@332', kind: 'hard-brake', targetSpeedKph: 85, clip: 'hard-brake', followClip: null, generation, priority: 1, decidedMonoMs: 0, ttlMs: 1000 };
}

describe('seen cues', () => {
  it('seen_cues_keep_the_first_time_within_a_generation', () => {
    const seen = new SeenCues();
    expect(seen.firstSeenMs(cue('1:a', 1), 100)).toBe(100);
    expect(seen.firstSeenMs(cue('1:a', 1), 900)).toBe(100);
    expect(seen.firstSeenMs(cue('1:b', 1), 900)).toBe(900);
  });

  it('seen_cues_are_cleared_on_a_new_generation', () => {
    const seen = new SeenCues();
    seen.firstSeenMs(cue('1:a', 1), 100);
    seen.firstSeenMs(cue('1:b', 1), 200);
    expect(seen.firstSeenMs(cue('2:a', 2), 5000)).toBe(5000);
  });
});
