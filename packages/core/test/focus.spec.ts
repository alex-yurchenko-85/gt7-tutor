import { describe, expect, it } from 'vitest';
import { buildReview } from '../src/compare.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { findDifferences, type Finding } from '../src/findings.ts';
import { FOCUS_KIND_ORDER, brakeReactions, focusFor, type FocusAttempt } from '../src/focus.ts';
import { reviewLosses, type TurnLoss } from '../src/turns.ts';
import { between, samplesOf } from './fixtures.ts';
import { interlagosAnalysis } from './paths.ts';
import { FRAME_MS, syntheticSample } from './synthetic.ts';

type Parts = TurnLoss['parts'];

function loss(turn: number, lostMs: number | null, parts: Parts | null = null, fromSM = (turn - 1) * 100, toSM = turn * 100, entrySM = fromSM, exitSM = fromSM): TurnLoss {
  return { turn, fromSM, toSM, entrySM, exitSM, lostMs, parts: parts ?? { approach: lostMs === null ? null : 0, entry: lostMs === null ? null : 0, exit: lostMs } };
}

function finding(kind: Finding['kind'], sM: number, size = 5): Finding {
  return { kind, eventKey: `${kind}@${sM}`, sM, size, unit: kind === 'slow-corner' ? 'm/s' : 'm' };
}

function attempt(losses: (number | null)[], findings: Finding[] = []): FocusAttempt {
  return { losses: losses.map((lostMs, index) => loss(index + 1, lostMs)), findings };
}

function split(approach: number, entry: number, exit: number, findings: Finding[] = []): FocusAttempt {
  return { losses: [loss(1, approach + entry + exit, { approach, entry, exit }, 0, 100, 30, 60)], findings };
}

describe('focus', () => {
  it('focus_takes_the_turn_with_the_largest_median_time_lost', () => {
    const window = [attempt([100, 300, 50], [finding('throttle-late', 20)]), attempt([400, 200, 900], [finding('throttle-late', 30)]), attempt([500, 250, 10])];
    expect(focusFor(window, DEFAULT_CONFIG)).toEqual({ turn: 1, part: 'exit', cause: 'throttle-late', clip: 'focus-exit-throttle-late-1' });
  });

  it('focus_turn_needs_no_difference_and_then_names_the_part_alone', () => {
    expect(focusFor([attempt([100, 800], [finding('slow-corner', 60)]), attempt([200, 900])], DEFAULT_CONFIG)).toEqual({ turn: 2, part: 'exit', cause: null, clip: 'focus-exit-2' });
  });

  it('focus_needs_a_turn_median_of_at_least_the_minimum', () => {
    expect(DEFAULT_CONFIG.focus.turnMinMs).toBe(100);
    expect(focusFor([attempt([0, -50], [finding('brake-early', 10)])], DEFAULT_CONFIG)).toBeNull();
    expect(focusFor([attempt([0, 99], [finding('throttle-late', 150)])], DEFAULT_CONFIG)).toBeNull();
    expect(focusFor([attempt([0, 100])], DEFAULT_CONFIG)).toMatchObject({ turn: 2 });
  });

  it('focus_median_uses_only_the_attempts_with_a_value', () => {
    expect(focusFor([attempt([null, 100]), attempt([300, 200]), attempt([null, 250])], DEFAULT_CONFIG)).toMatchObject({ turn: 1 });
  });

  it('focus_uses_only_the_window_of_the_latest_attempts', () => {
    const recent = Array.from({ length: DEFAULT_CONFIG.focus.attempts }, () => attempt([100, 50]));
    const older = Array.from({ length: 6 }, () => attempt([0, 5000]));
    expect(DEFAULT_CONFIG.focus.attempts).toBe(5);
    expect(focusFor([...recent, ...older], DEFAULT_CONFIG)).toMatchObject({ turn: 1 });
    expect(focusFor([...recent, ...older], { ...DEFAULT_CONFIG, focus: { ...DEFAULT_CONFIG.focus, attempts: 11 } })).toMatchObject({ turn: 2 });
  });

  it('part_is_the_first_part_above_the_minimum_and_the_share_of_the_turn_loss', () => {
    expect(DEFAULT_CONFIG.focus).toMatchObject({ partMinMs: 100, partMinShare: 0.2 });
    expect(focusFor([split(150, 300, 550)], DEFAULT_CONFIG)).toMatchObject({ part: 'entry' });
    expect(focusFor([split(120, 300, 80)], DEFAULT_CONFIG)).toMatchObject({ part: 'approach' });
    expect(focusFor([split(100, 101, 300)], DEFAULT_CONFIG)).toMatchObject({ part: 'entry' });
    expect(focusFor([split(0, 50, 400)], DEFAULT_CONFIG)).toMatchObject({ part: 'exit' });
  });

  it('part_is_the_largest_part_when_no_part_passes', () => {
    expect(focusFor([split(50, 60, 30)], DEFAULT_CONFIG)).toMatchObject({ part: 'entry', clip: 'focus-entry-1' });
    expect(focusFor([split(-100, 90, 160)], DEFAULT_CONFIG)).toMatchObject({ part: 'exit' });
    expect(focusFor([split(40, 40, 30)], DEFAULT_CONFIG)).toMatchObject({ part: 'approach' });
  });

  it('part_without_a_loss_is_never_the_focus_part', () => {
    const turnOne = (approach: number, entry: number, exit: number) => ({ losses: [loss(1, approach + entry + exit, { approach, entry, exit }), loss(2, 150, null)], findings: [] });
    expect(focusFor([turnOne(300, -120, -80), turnOne(-120, 300, -80), turnOne(-120, -80, 300)], DEFAULT_CONFIG)).toMatchObject({ turn: 2, part: 'exit' });
    expect(focusFor([split(300, -120, -80), split(-120, 300, -80), split(-120, -80, 300)], DEFAULT_CONFIG)).toBeNull();
  });

  it('part_uses_the_median_of_each_part_over_the_window', () => {
    expect(focusFor([split(300, 0, 300), split(0, 300, 300), split(0, 300, 300)], DEFAULT_CONFIG)).toMatchObject({ part: 'entry' });
  });

  it('cause_is_a_kind_of_the_part_in_half_or_more_of_the_window', () => {
    const window = [
      split(0, 400, 100, [finding('brake-early', 10), finding('slow-corner', 60)]),
      split(0, 400, 100, [finding('brake-early', 10), finding('slow-corner', 60), finding('throttle-late', 60)]),
      split(0, 400, 100, [finding('brake-early', 10), finding('throttle-late', 60)])
    ];
    expect(focusFor(window, DEFAULT_CONFIG)).toEqual({ turn: 1, part: 'entry', cause: 'slow-corner', clip: 'focus-entry-slow-1' });
  });

  it('cause_belongs_to_its_part_by_kind_not_by_place', () => {
    expect(focusFor([split(300, 0, 0, [finding('brake-early', 90)])], DEFAULT_CONFIG)).toMatchObject({ part: 'approach', cause: 'brake-early', clip: 'focus-approach-brake-early-1' });
    expect(focusFor([split(300, 0, 0, [finding('brake-late', 5)])], DEFAULT_CONFIG)).toMatchObject({ cause: 'brake-late', clip: 'focus-approach-brake-late-1' });
    expect(focusFor([split(0, 300, 0, [finding('low-point-early', 95)])], DEFAULT_CONFIG)).toMatchObject({ cause: 'low-point-early', clip: 'focus-entry-slow-1' });
    expect(focusFor([split(0, 300, 0, [finding('low-point-late', 5)])], DEFAULT_CONFIG)).toMatchObject({ cause: 'low-point-late', clip: 'focus-entry-fast-1' });
    expect(focusFor([split(0, 300, 0, [finding('wide-apex', 50)])], DEFAULT_CONFIG)).toMatchObject({ cause: 'wide-apex', clip: 'focus-entry-wide-apex-1' });
    expect(focusFor([split(0, 0, 300, [finding('throttle-late', 20)])], DEFAULT_CONFIG)).toMatchObject({ cause: 'throttle-late', clip: 'focus-exit-throttle-late-1' });
    expect(focusFor([split(0, 0, 300, [finding('brake-early', 20)])], DEFAULT_CONFIG)).toMatchObject({ part: 'exit', cause: null, clip: 'focus-exit-1' });
  });

  it('brake_late_is_a_cause_of_each_part_with_the_sentence_of_the_approach', () => {
    expect(focusFor([split(0, 300, 0, [finding('brake-late', 20)])], DEFAULT_CONFIG)).toEqual({ turn: 1, part: 'entry', cause: 'brake-late', clip: 'focus-approach-brake-late-1' });
    expect(focusFor([split(0, 0, 300, [finding('brake-late', 20)])], DEFAULT_CONFIG)).toEqual({ turn: 1, part: 'exit', cause: 'brake-late', clip: 'focus-approach-brake-late-1' });
    expect(focusFor([split(0, 300, 0, [finding('brake-late', 20), finding('low-point-early', 50)])], DEFAULT_CONFIG)).toMatchObject({ cause: 'brake-late' });
    const window = [split(0, 300, 0, [finding('brake-late', 20), finding('slow-corner', 50)]), split(0, 300, 0, [finding('slow-corner', 50)]), split(0, 300, 0, [finding('brake-late', 20), finding('slow-corner', 50)])];
    expect(focusFor(window, DEFAULT_CONFIG)).toMatchObject({ cause: 'slow-corner' });
  });

  it('cause_below_half_of_the_window_is_no_cause', () => {
    const window = [split(0, 300, 0, [finding('wide-apex', 50)]), split(0, 300, 0), split(0, 300, 0)];
    expect(focusFor(window, DEFAULT_CONFIG)).toMatchObject({ part: 'entry', cause: null, clip: 'focus-entry-1' });
  });

  it('off_line_is_the_cause_only_when_no_kind_of_the_part_is_in_half_of_the_window', () => {
    const offLine = (...others: Finding[]) => split(300, 0, 0, [finding('off-line', 10), ...others]);
    expect(focusFor([offLine(), offLine(finding('brake-early', 30)), offLine()], DEFAULT_CONFIG)).toMatchObject({ cause: 'off-line', clip: 'focus-approach-off-line-1' });
    expect(focusFor([offLine(finding('brake-early', 30)), offLine(finding('brake-early', 30)), offLine()], DEFAULT_CONFIG)).toMatchObject({ cause: 'brake-early' });
    expect(focusFor([split(0, 300, 0, [finding('off-line', 45)]), split(0, 300, 0), split(0, 300, 0)], DEFAULT_CONFIG)).toMatchObject({ cause: null });
    expect(focusFor([split(0, 0, 300, [finding('off-line', 70)])], DEFAULT_CONFIG)).toMatchObject({ clip: 'focus-exit-off-line-1' });
    expect(focusFor([split(0, 300, 0, [finding('off-line', 45)])], DEFAULT_CONFIG)).toMatchObject({ clip: 'focus-entry-off-line-1' });
  });

  it('off_line_counts_only_when_its_place_is_in_the_focus_part', () => {
    expect(focusFor([split(0, 300, 0, [finding('off-line', 10)])], DEFAULT_CONFIG)).toMatchObject({ part: 'entry', cause: null, clip: 'focus-entry-1' });
    expect(focusFor([split(0, 0, 300, [finding('off-line', 45)])], DEFAULT_CONFIG)).toMatchObject({ part: 'exit', cause: null, clip: 'focus-exit-1' });
    expect(focusFor([split(300, 0, 0, [finding('off-line', 30)])], DEFAULT_CONFIG)).toMatchObject({ part: 'approach', cause: null });
    expect(focusFor([split(0, 300, 0, [finding('off-line', 30)])], DEFAULT_CONFIG)).toMatchObject({ part: 'entry', cause: 'off-line' });
    expect(focusFor([split(0, 0, 300, [finding('off-line', 100)])], DEFAULT_CONFIG)).toMatchObject({ part: 'exit', cause: 'off-line' });
    const window = [split(0, 0, 300, [finding('off-line', 70)]), split(0, 0, 300, [finding('off-line', 10)]), split(0, 0, 300, [finding('off-line', 20)])];
    expect(focusFor(window, DEFAULT_CONFIG)).toMatchObject({ cause: null });
  });

  it('cause_counts_attempts_not_differences', () => {
    const window = [split(0, 300, 0, [finding('wide-apex', 50), finding('wide-apex', 60), finding('wide-apex', 70)]), split(0, 300, 0, [finding('slow-corner', 60)]), split(0, 300, 0, [finding('slow-corner', 60)])];
    expect(focusFor(window, DEFAULT_CONFIG)).toMatchObject({ cause: 'slow-corner' });
  });

  it('cause_tie_takes_the_fixed_kind_order', () => {
    expect(FOCUS_KIND_ORDER).toEqual(['brake-early', 'brake-late', 'low-point-early', 'low-point-late', 'slow-corner', 'wide-apex', 'throttle-late', 'off-line']);
    const both = (part: 'approach' | 'entry', first: Finding['kind'], second: Finding['kind']) =>
      focusFor([part === 'approach' ? split(300, 0, 0, [finding(second, 70), finding(first, 30)]) : split(0, 300, 0, [finding(second, 70), finding(first, 30)])], DEFAULT_CONFIG);
    expect(both('approach', 'brake-early', 'brake-late')).toMatchObject({ cause: 'brake-early' });
    expect(both('entry', 'low-point-early', 'low-point-late')).toMatchObject({ cause: 'low-point-early' });
    expect(both('entry', 'low-point-late', 'slow-corner')).toMatchObject({ cause: 'low-point-late' });
    expect(both('entry', 'slow-corner', 'wide-apex')).toMatchObject({ cause: 'slow-corner' });
  });

  it('focus_turn_tie_takes_the_lower_turn_number', () => {
    expect(focusFor([attempt([200, 200])], DEFAULT_CONFIG)).toMatchObject({ turn: 1 });
  });

  it('difference_belongs_to_the_loss_range_that_holds_its_place', () => {
    const ranges: TurnLoss[] = [loss(1, 10, null, 0, 120), loss(2, 500, null, 120, 300)];
    expect(focusFor([{ losses: ranges, findings: [finding('throttle-late', 120)] }], DEFAULT_CONFIG)).toMatchObject({ turn: 2, cause: 'throttle-late' });
    expect(focusFor([{ losses: ranges, findings: [finding('throttle-late', 119)] }], DEFAULT_CONFIG)).toMatchObject({ turn: 2, cause: null });
    expect(focusFor([{ losses: ranges, findings: [finding('throttle-late', 300)] }], DEFAULT_CONFIG)).toMatchObject({ turn: 2, cause: 'throttle-late' });
  });

  it('focus_is_null_without_a_turn_or_an_attempt', () => {
    expect(focusFor([attempt([], [finding('off-line', 120)])], DEFAULT_CONFIG)).toBeNull();
    expect(focusFor([], DEFAULT_CONFIG)).toBeNull();
  });

  it('focus_above_turn_ten_has_no_clip', () => {
    const losses = Array.from({ length: 11 }, (_, index) => (index === 10 ? 400 : 0));
    expect(focusFor([attempt(losses, [finding('throttle-late', 1050)])], DEFAULT_CONFIG)).toEqual({ turn: 11, part: 'exit', cause: 'throttle-late', clip: null });
  });

  it('focus_of_a_recorded_attempt_takes_its_turn_and_a_part', () => {
    const review = buildReview(between(samplesOf('ce-pause'), 11564, 13309), interlagosAnalysis(), DEFAULT_CONFIG);
    const losses = reviewLosses(review);
    const focus = focusFor([{ losses, findings: findDifferences(review, DEFAULT_CONFIG) }], DEFAULT_CONFIG);
    expect(focus?.turn).toBe(review.corners[0]!.number);
    expect(['approach', 'entry', 'exit']).toContain(focus?.part);
  });
});

describe('brake reaction', () => {
  function samples(brakeFromMs: number | null) {
    return Array.from({ length: 300 }, (_, index) => {
      const receivedMonoMs = 1000 + index * FRAME_MS;
      const braking = brakeFromMs !== null && receivedMonoMs >= brakeFromMs;
      return syntheticSample({ rawIndex: index, packetId: index + 1, receivedMonoMs, brake: braking ? 0.8 : 0.05 });
    });
  }

  it('brake_reaction_is_time_from_clip_start_to_brake', () => {
    const reactions = brakeReactions(samples(1700 + 1000), [{ eventKey: 'brake@332', clipStartMonoMs: 2000 }]);
    expect(reactions).toHaveLength(1);
    expect(reactions[0]!.eventKey).toBe('brake@332');
    expect(Math.abs(reactions[0]!.reactionMs - 700)).toBeLessThanOrEqual(17);
    expect(brakeReactions(samples(null), [{ eventKey: 'brake@332', clipStartMonoMs: 2000 }])).toEqual([]);
    expect(brakeReactions(samples(5100), [{ eventKey: 'brake@332', clipStartMonoMs: 2000 }])).toEqual([]);
  });

  it('braking_before_the_cue_gives_a_negative_reaction', () => {
    const reactions = brakeReactions(samples(2000 - 400), [{ eventKey: 'brake@332', clipStartMonoMs: 2000 }]);
    expect(reactions).toHaveLength(1);
    expect(Math.abs(reactions[0]!.reactionMs + 400)).toBeLessThanOrEqual(17);
  });

  it('braking_long_before_the_cue_gives_no_reaction', () => {
    expect(brakeReactions(samples(1000), [{ eventKey: 'brake@332', clipStartMonoMs: 4500 }])).toEqual([]);
  });
});

