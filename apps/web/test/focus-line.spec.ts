import { describe, expect, it } from 'vitest';
import { latestFocus } from '../src/features/attempts/latest-focus.ts';
import { attemptSummary } from './review-fixtures.ts';

const BRAKE = { turn: 1, part: 'approach' as const, cause: 'brake-early' as const, clip: 'focus-approach-brake-early-1' };
const EXIT = { turn: 2, part: 'exit' as const, cause: null, clip: null };

describe('latest focus', () => {
  it('takes_the_focus_of_the_newest_attempt_on_the_active_reference', () => {
    const list = {
      bestMs: null,
      days: [
        { date: '2026-11-17', bestMs: null, attempts: [attemptSummary({ id: 'a3', number: 3, focus: null, completion: 'aborted', timeMs: null }), attemptSummary({ id: 'a2', number: 2, focus: EXIT })] },
        { date: '2026-11-16', bestMs: null, attempts: [attemptSummary({ id: 'a1', number: 1, focus: BRAKE })] }
      ]
    };
    expect(latestFocus(list, 'ref-demo')).toEqual(EXIT);
  });

  it('uses_the_newest_complete_attempt_even_without_a_focus', () => {
    const list = { bestMs: null, days: [{ date: '2026-11-17', bestMs: null, attempts: [attemptSummary({ id: 'a2', number: 2, focus: null }), attemptSummary({ id: 'a1', number: 1, focus: BRAKE })] }] };
    expect(latestFocus(list, 'ref-demo')).toBeNull();
  });

  it('skips_attempts_on_another_reference', () => {
    const list = { bestMs: null, days: [{ date: '2026-11-17', bestMs: null, attempts: [attemptSummary({ id: 'a2', number: 2, referenceId: 'ref-old', focus: EXIT }), attemptSummary({ id: 'a1', number: 1, focus: BRAKE })] }] };
    expect(latestFocus(list, 'ref-demo')).toEqual(BRAKE);
  });

  it('has_no_focus_without_a_list_a_reference_or_a_focus', () => {
    expect(latestFocus(null, 'ref-demo')).toBeNull();
    expect(latestFocus({ bestMs: null, days: [] }, 'ref-demo')).toBeNull();
    expect(latestFocus({ bestMs: null, days: [{ date: '2026-11-17', bestMs: null, attempts: [attemptSummary({ focus: BRAKE })] }] }, null)).toBeNull();
  });
});
