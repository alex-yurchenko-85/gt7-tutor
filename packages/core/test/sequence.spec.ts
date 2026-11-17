import { describe, expect, it } from 'vitest';
import type { Sample } from '@gt7/contracts';
import { SequenceTracker } from '../src/sequence.ts';

function sample(packetId: number): Sample {
  return {
    rawIndex: 0,
    packetId,
    receivedMonoMs: 0,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    speedMps: 0,
    throttle: 0,
    brake: 0,
    gear: 0,
    lap: 0,
    carId: 0,
    flags: 0,
    playerSession: false,
    paused: false,
    loading: false
  };
}

const clean = { gapPackets: 0, duplicate: false, discontinuity: false };

describe('SequenceTracker', () => {
  it('sequence_detects_gap_duplicate_and_wrap', () => {
    const tracker = new SequenceTracker();
    expect(tracker.accept(sample(10))).toEqual(clean);
    expect(tracker.accept(sample(11))).toEqual(clean);
    expect(tracker.accept(sample(14))).toEqual({ ...clean, gapPackets: 2 });
    expect(tracker.accept(sample(14))).toEqual({ ...clean, duplicate: true });
    expect(tracker.accept(sample(15))).toEqual(clean);

    const wrapping = new SequenceTracker();
    wrapping.accept(sample(0xfffffffe));
    expect(wrapping.accept(sample(0xffffffff))).toEqual(clean);
    expect(wrapping.accept(sample(0))).toEqual(clean);
    expect(wrapping.accept(sample(2))).toEqual({ ...clean, gapPackets: 1 });
  });

  it('late_reordered_packet_is_a_duplicate_and_keeps_position', () => {
    const tracker = new SequenceTracker();
    tracker.accept(sample(100));
    tracker.accept(sample(102));
    expect(tracker.accept(sample(101))).toEqual({ ...clean, duplicate: true });
    expect(tracker.accept(sample(103))).toEqual(clean);
  });

  it('stream_reset_is_a_discontinuity', () => {
    const tracker = new SequenceTracker();
    tracker.accept(sample(500_000));
    expect(tracker.accept(sample(7))).toEqual({ ...clean, discontinuity: true });
    expect(tracker.accept(sample(8))).toEqual(clean);
    expect(tracker.accept(sample(8 + 100_000))).toEqual({ ...clean, discontinuity: true });
  });

  it('reset_forgets_the_last_packet', () => {
    const tracker = new SequenceTracker();
    tracker.accept(sample(100));
    tracker.reset();
    expect(tracker.accept(sample(5))).toEqual(clean);
  });
});
