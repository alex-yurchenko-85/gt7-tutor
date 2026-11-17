import { describe, expect, it } from 'vitest';
import { buildReview } from '../src/compare.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import type { Corner } from '../src/corners.ts';
import { findDifferences, type Finding, type Recurring } from '../src/findings.ts';
import { brakeReactions, focusSentence } from '../src/focus.ts';
import { between, samplesOf } from './fixtures.ts';
import { yangwangReference } from './paths.ts';
import { FRAME_MS, syntheticSample } from './synthetic.ts';

function corner(number: number): Corner {
  const apexSM = number * 100 + 50;
  return { number, zoneStartSM: number * 100, turnInSM: apexSM - 20, apexSM, radiusM: 50, apexSpeedKph: 100, insideSign: 1 };
}

const corners = [corner(1), corner(2), corner(3)];

function finding(kind: Finding['kind'], sM: number, size: number): Finding {
  return { kind, eventKey: `${kind}@${sM}`, sM, size, unit: kind === 'slow-corner' ? 'km/h' : 'm' };
}

function repeated(found: Finding, count: number, medianSize = found.size): Recurring {
  return { ...found, count, of: 8, medianSize };
}

describe('focus sentence', () => {
  it('focus_uses_the_most_frequent_recurring_difference', () => {
    const latest = [finding('off-line', 120, 9)];
    const recurringOnes = [
      repeated(finding('brake-early', 110, 12), 4),
      repeated(finding('wide-apex', 250, 3), 6),
      repeated(finding('throttle-late', 320, 20), 6, 15)
    ];
    expect(focusSentence(recurringOnes, latest, corners)).toEqual({
      kind: 'throttle-late',
      turn: 3,
      text: 'Turn three. Throttle earlier.',
      clip: 'focus-throttle-late-3'
    });
  });

  it('focus_without_recurring_uses_the_largest_finding', () => {
    const latest = [finding('off-line', 120, 3), finding('brake-late', 210, 14)];
    expect(focusSentence([], latest, corners)).toMatchObject({ kind: 'brake-late', turn: 2, text: 'Turn two. Brake earlier.' });

    const path = yangwangReference();
    const review = buildReview(between(samplesOf('player-run'), 1163, 2787), path, DEFAULT_CONFIG);
    const focus = focusSentence([], findDifferences(review, DEFAULT_CONFIG), review.corners);
    expect(focus).toEqual({ kind: 'brake-early', turn: 1, text: 'Turn one. Brake later.', clip: 'focus-brake-early-1' });
  });

  it('focus_is_null_without_corners', () => {
    expect(focusSentence([repeated(finding('off-line', 120, 3), 5)], [finding('off-line', 120, 3)], [])).toBeNull();
    expect(focusSentence([], [], corners)).toBeNull();
  });

  it('difference_before_the_first_corner_uses_turn_one', () => {
    expect(focusSentence([], [finding('off-line', 20, 3)], corners)).toMatchObject({ turn: 1 });
    expect(focusSentence([], [finding('off-line', 900, 3)], corners)).toMatchObject({ turn: 3 });
  });

  it('focus_above_turn_ten_has_no_clip', () => {
    const eleven = Array.from({ length: 11 }, (_, index) => corner(index + 1));
    expect(focusSentence([], [finding('slow-corner', 1120, 12)], eleven)).toEqual({
      kind: 'slow-corner',
      turn: 11,
      text: 'Turn 11. Carry more speed.',
      clip: null
    });
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

