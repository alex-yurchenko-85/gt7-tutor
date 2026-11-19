import { describe, expect, it } from 'vitest';
import type { Sample } from '@gt7/contracts';
import { cutToTimerRun, demonstrationRuns, findDemoRangeCandidates, matchesReference, type DemoRangeCandidate } from '../src/demo-range.ts';
import { samplesOf, type FixtureName } from './fixtures.ts';
import { interlagosReference } from './paths.ts';
import { drive, renumber, straightLine } from './synthetic.ts';

const demos: FixtureName[] = ['demo-a', 'demo-b', 'demo-c'];

function rangesOf(candidate: DemoRangeCandidate | undefined): [number, number][] {
  return (candidate?.ranges ?? []).map(range => [range.first, range.last]);
}

const demonstration: [number, number][] = [
  [457, 1422],
  [738, 1703],
  [1054, 2019]
];

function timerAt(capture: Sample[], rawIndex: number): number {
  return capture.find(sample => sample.rawIndex === rawIndex)!.gameTimerMs;
}

describe('findDemoRangeCandidates', () => {
  const captures = demos.map(name => samplesOf(name));

  it('three_captures_give_the_demonstration', () => {
    const [best] = findDemoRangeCandidates(captures);
    expect(rangesOf(best)).toEqual(demonstration);
    expect(best!.sampleCount).toBe(966);
    expect(best!.ambiguous).toBe(false);
    expect(best!.evidence.some(line => line.includes('START'))).toBe(false);
  });

  it('cut_the_reference_to_the_demonstration_timer', () => {
    const candidates = findDemoRangeCandidates(captures);
    const eligible = candidates.filter(candidate => !candidate.ambiguous);
    expect(eligible).toHaveLength(1);
    expect(eligible[0]!.timed).toBe(true);
    eligible[0]!.ranges.forEach((range, index) => {
      expect(timerAt(captures[index]!, range.first)).toBe(0);
      expect(timerAt(captures[index]!, range.first + 1)).toBeGreaterThan(0);
      expect(timerAt(captures[index]!, range.last)).toBe(16082);
      expect(timerAt(captures[index]!, range.last - 1)).toBeLessThan(16082);
    });
    expect(eligible[0]!.evidence.filter(line => line.includes('timer runs 16.082 s'))).toHaveLength(3);
  });

  it('cut_ignores_a_background_timer_outside_the_candidate', () => {
    const backgroundStart = captures[2]!.find(sample => sample.rawIndex === 759)!;
    expect(backgroundStart.gameTimerMs).toBeGreaterThan(0);
    const [best] = findDemoRangeCandidates(captures);
    expect(best!.ranges[2]).toEqual({ first: 1054, last: 2019 });
  });

  it('candidate_without_a_timer_run_is_not_eligible', () => {
    const untimed = captures[1]!.map(sample => ({ ...sample, gameTimerMs: 0 }));
    const candidates = findDemoRangeCandidates([captures[0]!, untimed, captures[2]!]);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every(candidate => candidate.ambiguous && !candidate.timed)).toBe(true);
    expect(candidates[0]!.evidence).toContain('Capture 2: no complete timer run');
  });

  it('timed_candidate_ranks_before_a_longer_untimed_one', () => {
    const uncut: [number, number][] = [
      [382, 1597],
      [664, 1878],
      [979, 2194]
    ];
    const withCopy = captures.map((capture, index) => {
      const [first, last] = uncut[index]!;
      const end = capture.at(-1)!;
      const copy = capture
        .filter(sample => sample.rawIndex >= first && sample.rawIndex <= last)
        .map((sample, offset) => ({
          ...sample,
          rawIndex: end.rawIndex + 1 + offset,
          packetId: end.packetId + 1 + offset,
          receivedMonoMs: end.receivedMonoMs + 2000 + offset * (1000 / 60),
          position: { ...sample.position, x: sample.position.x + 5000 },
          gameTimerMs: 0
        }));
      return [...capture, ...copy];
    });
    const candidates = findDemoRangeCandidates(withCopy);
    const untimed = candidates.findIndex(candidate => candidate.evidence.includes('Capture 1: no complete timer run') && candidate.sampleCount === 1216);
    expect(untimed).toBeGreaterThan(0);
    expect(candidates[untimed]!.timed).toBe(false);
    expect(rangesOf(candidates[0])).toEqual(demonstration);
    expect(candidates[0]!.timed).toBe(true);
  });

  it('background_candidate_ranks_lower', () => {
    const candidates = findDemoRangeCandidates(captures);
    const background = candidates.findIndex(candidate => {
      const range = candidate.ranges[0]!;
      return range.first === 1606 && range.last === 1727;
    });
    expect(background).toBeGreaterThan(0);
    expect(candidates[background]!.ambiguous).toBe(true);
  });

  it('two_captures_mark_ambiguous', () => {
    const candidates = findDemoRangeCandidates(captures.slice(0, 2));
    expect(rangesOf(candidates[0])).toEqual(demonstration.slice(0, 2));
    expect(candidates.every(candidate => candidate.ambiguous)).toBe(true);
  });

  it('physical_key_ignores_packet_id_and_time', () => {
    const offsetMs = 123_456;
    const relabelled: Sample[] = captures[1]!.map(sample => ({
      ...sample,
      packetId: sample.packetId + 1_000_000,
      receivedMonoMs: sample.receivedMonoMs + offsetMs,
      flags: sample.flags ^ 0x400,
      lap: sample.lap + 5
    }));
    const [best] = findDemoRangeCandidates([captures[0]!, relabelled, captures[2]!]);
    expect(rangesOf(best)).toEqual(demonstration);
    expect(best!.ambiguous).toBe(false);
  });

  it('missing_frame_does_not_split_the_demonstration', () => {
    const gapped = captures[2]!.filter(sample => sample.rawIndex !== 1500);
    const [best] = findDemoRangeCandidates([captures[0]!, captures[1]!, gapped]);
    expect(rangesOf(best)).toEqual(demonstration);
    expect(best!.sampleCount).toBe(966);
  });

  it('candidates_that_cut_to_the_same_timer_run_give_one_candidate', () => {
    const runFrom = 300;
    const runTo = 420;
    const timerOf = (index: number) => (index <= runFrom ? 0 : (Math.min(index, runTo) - runFrom) * 16);
    const line = drive(straightLine({ fromX: 0, toX: 240, speedMps: 20 }), { playerSession: false }).map((sample, index) => ({
      ...sample,
      gameTimerMs: timerOf(index)
    }));
    const away = (fromX: number) => drive(straightLine({ fromX, toX: fromX + 5, speedMps: 20 }).slice(0, 5), { playerSession: false });
    const whole = renumber([...away(5000), ...line]);
    const split = renumber([...away(5000), ...line.slice(0, 471), ...away(-5000), ...line.slice(250)]);
    const candidates = findDemoRangeCandidates([whole, whole, split]);
    expect(candidates.filter(candidate => candidate.timed)).toHaveLength(1);
    expect(rangesOf(candidates[0])).toEqual([
      [305, 425],
      [305, 425],
      [305, 425]
    ]);
  });

  it('no_common_movement_gives_no_candidate', () => {
    const elsewhere = captures[1]!.map(sample => ({ ...sample, position: { ...sample.position, x: sample.position.x + 5000 } }));
    expect(findDemoRangeCandidates([captures[0]!, elsewhere, captures[2]!])).toEqual([]);
  });
});

describe('demonstrationRuns', () => {
  const demoA = samplesOf('demo-a');

  it('one_recording_gives_the_demonstration_run', () => {
    expect(demonstrationRuns(demoA)).toEqual([{ first: 457, last: 1422, gameTimeMs: 16082 }]);
  });

  it('cut_recording_gives_no_proposal', () => {
    expect(demonstrationRuns(demoA.filter(sample => sample.rawIndex <= 1421))).toEqual([]);
  });

  it('each_demonstration_recording_gives_one_run', () => {
    expect(demonstrationRuns(samplesOf('demo-b'))).toEqual([{ first: 738, last: 1703, gameTimeMs: 16082 }]);
    expect(demonstrationRuns(samplesOf('demo-c'))).toEqual([{ first: 1054, last: 2019, gameTimeMs: 16082 }]);
  });

  it('background_run_without_a_scene_change_before_it_is_not_a_demonstration', () => {
    const cut = samplesOf('demo-c').filter(sample => sample.rawIndex <= 2018);
    expect(cutToTimerRun(cut, { first: 0, last: 2018 }, 'demonstration')).toEqual({ first: 758, last: 970, gameTimeMs: 3533 });
    expect(demonstrationRuns(cut)).toEqual([]);
  });

  it('timer_run_that_does_not_move_is_not_a_demonstration', () => {
    const still = demoA.map(sample => (sample.rawIndex >= 382 ? { ...sample, position: demoA[382]!.position } : sample));
    expect(cutToTimerRun(still, { first: 0, last: 1727 }, 'demonstration')).toEqual({ first: 457, last: 1422, gameTimeMs: 16082 });
    expect(demonstrationRuns(still)).toEqual([]);
  });

  it('empty_recording_gives_no_run', () => {
    expect(demonstrationRuns([])).toEqual([]);
  });

  it('every_run_in_one_recording_is_listed_in_order', () => {
    const end = demoA.at(-1)!;
    const again = demoA.map((sample, offset) => ({
      ...sample,
      rawIndex: end.rawIndex + 1 + offset,
      packetId: end.packetId + 1 + offset,
      receivedMonoMs: end.receivedMonoMs + 2000 + offset * (1000 / 60)
    }));
    const shift = end.rawIndex + 1 - demoA[0]!.rawIndex;
    expect(demonstrationRuns([...demoA, ...again])).toEqual([
      { first: 457, last: 1422, gameTimeMs: 16082 },
      { first: 457 + shift, last: 1422 + shift, gameTimeMs: 16082 }
    ]);
  });

  it('player_runs_are_not_demonstration_runs', () => {
    expect(demonstrationRuns(samplesOf('ce-clean'))).toEqual([]);
  });
});

describe('cutToTimerRun', () => {
  const demoA = samplesOf('demo-a');
  const ceClean = samplesOf('ce-clean');

  it('wide_range_is_cut_to_the_demonstration_timer_run', () => {
    expect(cutToTimerRun(demoA, { first: 300, last: 1700 }, 'demonstration')).toEqual({ first: 457, last: 1422, gameTimeMs: 16082 });
  });

  it('range_that_ends_at_the_finish_keeps_its_run', () => {
    expect(cutToTimerRun(demoA, { first: 457, last: 1422 }, 'demonstration')).toEqual({ first: 457, last: 1422, gameTimeMs: 16082 });
  });

  it('range_that_ends_before_the_finish_has_no_run', () => {
    expect(cutToTimerRun(demoA, { first: 300, last: 1421 }, 'demonstration')).toBeNull();
  });

  it('range_that_starts_after_the_timer_start_has_no_run', () => {
    expect(cutToTimerRun(demoA, { first: 458, last: 1700 }, 'demonstration')).toBeNull();
  });

  it('range_before_the_demonstration_has_no_run', () => {
    expect(cutToTimerRun(demoA, { first: 0, last: 300 }, 'demonstration')).toBeNull();
  });

  it('range_outside_the_capture_has_no_run', () => {
    expect(cutToTimerRun(demoA, { first: 5000, last: 6000 }, 'demonstration')).toBeNull();
  });

  it('player_attempt_is_cut_to_the_player_timer_run', () => {
    const base = ceClean[0]!.rawIndex;
    const run = cutToTimerRun(ceClean, { first: base + 381, last: base + 1409 }, 'player');
    expect(run).toEqual({ first: base + 381, last: base + 1406, gameTimeMs: 17071 });
    expect(timerAt(ceClean, run!.first)).toBe(0);
    expect(timerAt(ceClean, run!.last)).toBe(17071);
    expect(timerAt(ceClean, run!.last - 1)).toBeLessThan(17071);
  });

  it('player_session_ignores_the_demonstration_timer', () => {
    expect(cutToTimerRun(demoA, { first: 300, last: 1700 }, 'player')).toBeNull();
  });
});

describe('matchesReference', () => {
  it('one_capture_confirms_stored_reference', () => {
    expect(matchesReference(samplesOf('demo-b'), interlagosReference())).toEqual({ first: 737, last: 1704 });
  });

  it('changed_demo_does_not_confirm', () => {
    const slower = samplesOf('demo-b').map(sample => ({ ...sample, speedMps: sample.speedMps * 0.97 }));
    expect(matchesReference(slower, interlagosReference())).toBeNull();
  });

  it('player_attempt_does_not_confirm', () => {
    expect(matchesReference(samplesOf('ce-clean'), interlagosReference())).toBeNull();
  });
});
