import { describe, expect, it } from 'vitest';
import type { Sample } from '@gt7/contracts';
import { cutToTimerRun, findDemoRangeCandidates, matchesReference, type DemoRangeCandidate } from '../src/demo-range.ts';
import { samplesOf, type FixtureName } from './fixtures.ts';
import { interlagosReference } from './paths.ts';
import { drive, renumber, straightLine } from './synthetic.ts';
import manifest from '../../../fixtures/manifest.json' with { type: 'json' };

const demos: FixtureName[] = ['demo-a', 'demo-b', 'demo-c'];

function cueOf(name: FixtureName): number {
  const cue = manifest.fixtures.find(fixture => fixture.name === name)!.startCueMonoMs;
  if (cue === null) throw new Error(`${name} has no START cue`);
  return cue;
}

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
  const cues = demos.map(cueOf);

  it('three_captures_give_the_demonstration', () => {
    const [best] = findDemoRangeCandidates(captures, cues);
    expect(rangesOf(best)).toEqual(demonstration);
    expect(best!.sampleCount).toBe(966);
    expect(best!.ambiguous).toBe(false);
    expect(best!.evidence.some(line => line.includes('after START'))).toBe(true);
  });

  it('cut_the_reference_to_the_demonstration_timer', () => {
    const candidates = findDemoRangeCandidates(captures, cues);
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
    const [best] = findDemoRangeCandidates(captures, cues);
    expect(best!.ranges[2]).toEqual({ first: 1054, last: 2019 });
  });

  it('candidate_without_a_timer_run_is_not_eligible', () => {
    const untimed = captures[1]!.map(sample => ({ ...sample, gameTimerMs: 0 }));
    const candidates = findDemoRangeCandidates([captures[0]!, untimed, captures[2]!], cues);
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
    const copyCues = withCopy.map((capture, index) => capture.find(sample => sample.rawIndex === captures[index]!.at(-1)!.rawIndex + 1)!.receivedMonoMs - 1000);
    const candidates = findDemoRangeCandidates(withCopy, copyCues);
    const untimed = candidates.findIndex(candidate => candidate.evidence.includes('Capture 1: no complete timer run') && candidate.sampleCount === 1216);
    expect(untimed).toBeGreaterThan(0);
    expect(candidates[untimed]!.timed).toBe(false);
    expect(rangesOf(candidates[0])).toEqual(demonstration);
    expect(candidates[0]!.timed).toBe(true);
  });

  it('background_candidate_ranks_lower', () => {
    const candidates = findDemoRangeCandidates(captures, cues);
    const background = candidates.findIndex(candidate => {
      const range = candidate.ranges[0]!;
      return range.first === 1606 && range.last === 1727;
    });
    expect(background).toBeGreaterThan(0);
    expect(candidates[background]!.ambiguous).toBe(true);
  });

  it('missing_start_cue_is_allowed', () => {
    const [best] = findDemoRangeCandidates(captures, [cues[0]!, null, cues[2]!]);
    expect(rangesOf(best)).toEqual(demonstration);
    expect(best!.evidence.some(line => line.includes('START cue missing'))).toBe(true);
  });

  it('two_captures_mark_ambiguous', () => {
    const candidates = findDemoRangeCandidates(captures.slice(0, 2), cues.slice(0, 2));
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
    const [best] = findDemoRangeCandidates([captures[0]!, relabelled, captures[2]!], [cues[0]!, cues[1]! + offsetMs, cues[2]!]);
    expect(rangesOf(best)).toEqual(demonstration);
    expect(best!.ambiguous).toBe(false);
  });

  it('missing_frame_does_not_split_the_demonstration', () => {
    const gapped = captures[2]!.filter(sample => sample.rawIndex !== 1500);
    const [best] = findDemoRangeCandidates([captures[0]!, captures[1]!, gapped], cues);
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
    const candidates = findDemoRangeCandidates([whole, whole, split], [null, null, null]);
    expect(candidates.filter(candidate => candidate.timed)).toHaveLength(1);
    expect(rangesOf(candidates[0])).toEqual([
      [305, 425],
      [305, 425],
      [305, 425]
    ]);
  });

  it('no_common_movement_gives_no_candidate', () => {
    const elsewhere = captures[1]!.map(sample => ({ ...sample, position: { ...sample.position, x: sample.position.x + 5000 } }));
    expect(findDemoRangeCandidates([captures[0]!, elsewhere, captures[2]!], cues)).toEqual([]);
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
