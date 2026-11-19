import { describe, expect, it } from 'vitest';
import { compareVoice } from '../src/features/attempts/voice-compare.ts';
import { attemptSummary } from './review-fixtures.ts';

describe('compareVoice', () => {
  it('voice_comparison_uses_complete_attempts_only', () => {
    const result = compareVoice([
      attemptSummary({ mode: 'baseline', timeMs: 27000 }),
      attemptSummary({ mode: 'baseline', timeMs: 28000 }),
      attemptSummary({ mode: 'baseline', timeMs: null, completion: 'aborted' }),
      attemptSummary({ mode: 'baseline', timeMs: 20000, completion: 'aborted' }),
      attemptSummary({ mode: 'guided', timeMs: 26500 }),
      attemptSummary({ mode: 'guided', timeMs: 26900 }),
      attemptSummary({ mode: 'guided', timeMs: 26700 })
    ], 'ref-demo');
    expect(result).toEqual({ baseline: { medianMs: 27500, count: 2 }, guided: { medianMs: 26700, count: 3 }, changeMs: -800 });
  });

  it('change_null_when_a_group_is_empty', () => {
    expect(compareVoice([attemptSummary({ mode: 'baseline', timeMs: 27000 })], 'ref-demo')).toEqual({
      baseline: { medianMs: 27000, count: 1 },
      guided: { medianMs: null, count: 0 },
      changeMs: null
    });
  });

  it('voice_comparison_uses_game_times_of_the_active_reference', () => {
    const result = compareVoice(
      [
        attemptSummary({ mode: 'baseline', timeMs: 27000 }),
        attemptSummary({ mode: 'baseline', timeMs: 21000, referenceId: 'ref-old' }),
        attemptSummary({ mode: 'guided', timeMs: 26500 }),
        attemptSummary({ mode: 'guided', timeMs: 20000, referenceId: 'ref-old' })
      ],
      'ref-demo'
    );
    expect(result).toEqual({ baseline: { medianMs: 27000, count: 1 }, guided: { medianMs: 26500, count: 1 }, changeMs: -500 });
  });

  it('voice_comparison_skips_attempts_without_a_game_time', () => {
    const result = compareVoice(
      [attemptSummary({ mode: 'baseline', timeMs: null }), attemptSummary({ mode: 'guided', timeMs: 26500 })],
      'ref-demo'
    );
    expect(result).toEqual({ baseline: { medianMs: null, count: 0 }, guided: { medianMs: 26500, count: 1 }, changeMs: null });
  });
});
