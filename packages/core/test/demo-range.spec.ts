import { describe, expect, it } from 'vitest';
import type { Sample } from '@gt7/contracts';
import { findDemoRangeCandidates, matchesReference, type DemoRangeCandidate } from '../src/demo-range.ts';
import { samplesOf, type FixtureName } from './fixtures.ts';
import { yangwangReference } from './paths.ts';
import manifest from '../../../fixtures/manifest.json' with { type: 'json' };

const demos: FixtureName[] = ['demo-wait05', 'demo-wait10', 'demo-wait15'];

function cueOf(name: FixtureName): number {
  const cue = manifest.fixtures.find(fixture => fixture.name === name)!.startCueMonoMs;
  if (cue === null) throw new Error(`${name} has no START cue`);
  return cue;
}

function rangesOf(candidate: DemoRangeCandidate | undefined): [number, number][] {
  return (candidate?.ranges ?? []).map(range => [range.first, range.last]);
}

const demonstration: [number, number][] = [
  [352, 1897],
  [655, 2200],
  [978, 2523]
];

describe('findDemoRangeCandidates', () => {
  const captures = demos.map(name => samplesOf(name));
  const cues = demos.map(cueOf);

  it('three_captures_give_the_demonstration', () => {
    const [best] = findDemoRangeCandidates(captures, cues);
    expect(rangesOf(best)).toEqual(demonstration);
    expect(best!.sampleCount).toBe(1546);
    expect(best!.ambiguous).toBe(false);
    expect(best!.evidence.some(line => line.includes('after START'))).toBe(true);
  });

  it('background_candidate_ranks_lower', () => {
    const candidates = findDemoRangeCandidates(captures, cues);
    const background = candidates.findIndex(candidate => {
      const range = candidate.ranges[0]!;
      return range.first >= 1898 && range.first <= 1906 && range.last === 2375;
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
    expect(best!.sampleCount).toBe(1546);
  });

  it('no_common_movement_gives_no_candidate', () => {
    const elsewhere = captures[1]!.map(sample => ({ ...sample, position: { ...sample.position, x: sample.position.x + 5000 } }));
    expect(findDemoRangeCandidates([captures[0]!, elsewhere, captures[2]!], cues)).toEqual([]);
  });
});

describe('matchesReference', () => {
  it('one_capture_confirms_stored_reference', () => {
    expect(matchesReference(samplesOf('demo-wait10'), yangwangReference())).toEqual({ first: 655, last: 2200 });
  });

  it('changed_demo_does_not_confirm', () => {
    const slower = samplesOf('demo-wait10').map(sample => ({ ...sample, speedMps: sample.speedMps * 0.97 }));
    expect(matchesReference(slower, yangwangReference())).toBeNull();
  });

  it('player_attempt_does_not_confirm', () => {
    expect(matchesReference(samplesOf('player-run'), yangwangReference())).toBeNull();
  });
});
