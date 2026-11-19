import { describe, expect, it } from 'vitest';
import { CLOCK_WARMUP_PACKETS, ENVELOPE_RISE, NOMINAL_PACKET_MS, PacketClock, clockOf, clockWarmupStart, withPacketClock } from '../src/packet-clock.ts';
import { samplesOf } from './fixtures.ts';
import { syntheticSample } from './synthetic.ts';

const INTERVAL_MS = 16.72;

function arrivals(count: number): number[] {
  const times = Array.from({ length: count }, (_, index) => 1000 + index * INTERVAL_MS);
  for (let burst = 37; burst < count - 4; burst += 53) {
    for (let late = 0; late < 4; late++) times[burst + late] = times[burst + 4]! + 0.5 * late;
  }
  return times;
}

function run(ids: number[], times: number[]): number[] {
  const clock = new PacketClock();
  return ids.map((id, index) => clock.next(id, times[index]!));
}

describe('PacketClock', () => {
  it('packet_clock_ignores_arrival_bursts', () => {
    const count = 600;
    const clocks = run(Array.from({ length: count }, (_, index) => 5000 + index), arrivals(count));
    for (let index = 1; index < count; index++) expect(Math.abs(clocks[index]! - clocks[index - 1]! - INTERVAL_MS)).toBeLessThan(4);
    expect(Math.abs(clocks.at(-1)! - clocks[0]! - (count - 1) * INTERVAL_MS)).toBeLessThan(5);
  });

  it('packet_clock_follows_a_change_of_the_packet_rate', () => {
    const slow = 17.2;
    const times = Array.from({ length: 900 }, (_, index) => (index < 300 ? index * INTERVAL_MS : 300 * INTERVAL_MS + (index - 300) * slow));
    const clocks = run(
      times.map((_, index) => index),
      times
    );
    expect(Math.abs(clocks.at(-1)! - times.at(-1)!)).toBeLessThan(30);
    expect(clocks.at(-1)! - clocks[600]!).toBeCloseTo(299 * slow, 0);
  });

  it('packet_clock_moves_to_an_early_arrival_and_little_to_a_late_one', () => {
    expect(run([10, 11], [100, 110])).toEqual([100, 110]);
    const late = run([10, 11], [100, 160]);
    expect(late[1]).toBeCloseTo(100 + NOMINAL_PACKET_MS + ENVELOPE_RISE * (60 - NOMINAL_PACKET_MS), 9);
  });

  it('packet_clock_counts_lost_packets', () => {
    const clocks = run([10, 13], [100, 150]);
    expect(clocks[1]! - clocks[0]!).toBeCloseTo(3 * NOMINAL_PACKET_MS, 9);
  });

  it('packet_clock_keeps_time_on_a_duplicate', () => {
    const clocks = run([10, 11, 11], [100, 117, 130]);
    expect(clocks[2]).toBe(clocks[1]);
  });

  it('packet_clock_wraps_the_32_bit_id', () => {
    const clocks = run([0xffffffff, 0, 1], [100, 100 + NOMINAL_PACKET_MS, 100 + 2 * NOMINAL_PACKET_MS]);
    expect(clocks[2]! - clocks[0]!).toBeCloseTo(2 * NOMINAL_PACKET_MS, 9);
  });

  it('packet_clock_uses_arrival_time_across_a_gap', () => {
    const ids = [...Array.from({ length: 200 }, (_, index) => index), 5000, 5001];
    const end = 199 * INTERVAL_MS;
    const times = [...Array.from({ length: 200 }, (_, index) => index * INTERVAL_MS), end + 4000, end + 4000 + INTERVAL_MS];
    const clocks = run(ids, times);
    expect(clocks[200]! - clocks[199]!).toBeCloseTo(4000, 6);
    expect(Math.abs(clocks[201]! - clocks[200]! - INTERVAL_MS)).toBeLessThan(0.5);
  });

  it('with_packet_clock_sets_clock_ms_and_clock_of_falls_back', () => {
    const samples = [syntheticSample({ packetId: 1, receivedMonoMs: 50 }), syntheticSample({ packetId: 2, receivedMonoMs: 90 })];
    const clocked = withPacketClock(samples);
    const expected = 50 + NOMINAL_PACKET_MS + ENVELOPE_RISE * (40 - NOMINAL_PACKET_MS);
    expect(clocked[0]!.clockMs).toBe(50);
    expect(clocked[1]!.clockMs).toBeCloseTo(expected, 9);
    expect(clockOf(clocked[1]!)).toBe(clocked[1]!.clockMs);
    expect(clockOf(samples[1]!)).toBe(90);
  });

  it('packet_clock_never_runs_backwards', () => {
    const clocks = run([10, 11, 12, 13], [160, 116.67, 133.33, 150]);
    for (let index = 1; index < clocks.length; index++) expect(clocks[index]!).toBeGreaterThanOrEqual(clocks[index - 1]!);
  });

  it('clock_warmup_starts_600_packets_before_the_range', () => {
    expect(CLOCK_WARMUP_PACKETS).toBe(600);
    expect(clockWarmupStart(1162)).toBe(562);
    expect(clockWarmupStart(352)).toBe(0);
  });

  it('clock_after_the_warmup_matches_the_clock_from_the_capture_start', () => {
    const all = samplesOf('ce-pause');
    for (const first of [12200, 12565, 13000, 13600]) {
      const fromStart = all.filter(sample => sample.rawIndex >= first);
      const warmed = withPacketClock(all.filter(sample => sample.rawIndex >= clockWarmupStart(first))).filter(sample => sample.rawIndex >= first);
      expect(warmed).toHaveLength(fromStart.length);
      const worst = fromStart.reduce(
        (most, sample, index) => Math.max(most, Math.abs(sample.clockMs! - fromStart[0]!.clockMs! - (warmed[index]!.clockMs! - warmed[0]!.clockMs!))),
        0
      );
      expect(worst).toBeLessThan(0.01);
    }
  });
});
