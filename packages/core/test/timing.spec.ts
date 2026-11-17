import { describe, expect, it } from 'vitest';
import type { Sample } from '@gt7/contracts';
import { measureAttemptMs } from '../src/timing.ts';
import { between, samplesOf } from './fixtures.ts';
import { yangwangReference } from './paths.ts';
import { FRAME_MS } from './synthetic.ts';

function withPause(samples: Sample[], afterRawIndex: number, frames: number): Sample[] {
  const at = samples.findIndex(sample => sample.rawIndex === afterRawIndex);
  const held = samples[at]!;
  const pause = Array.from({ length: frames }, (_, index) => ({
    ...held,
    paused: true,
    receivedMonoMs: held.receivedMonoMs + (index + 1) * FRAME_MS
  }));
  const shiftMs = frames * FRAME_MS;
  const later = samples.slice(at + 1).map(sample => ({ ...sample, receivedMonoMs: sample.receivedMonoMs + shiftMs }));
  return [...samples.slice(0, at + 1), ...pause, ...later];
}

describe('measureAttemptMs', () => {
  const playerRun = samplesOf('player-run');

  it('measured_time_of_player_run', () => {
    const measured = measureAttemptMs(playerRun, yangwangReference());
    expect(measured).not.toBeNull();
    expect(Math.abs(measured! / 1000 - 27.1)).toBeLessThanOrEqual(0.05);
  });

  it('measured_time_excludes_pause', () => {
    const plain = measureAttemptMs(playerRun, yangwangReference())!;
    const paused = measureAttemptMs(withPause(playerRun, 1800, 540), yangwangReference());
    expect(paused).not.toBeNull();
    expect(Math.abs(paused! - plain)).toBeLessThan(20);
  });

  it('measured_time_null_without_finish', () => {
    expect(measureAttemptMs(between(playerRun, 0, 2500), yangwangReference())).toBeNull();
    expect(measureAttemptMs(samplesOf('player-pause'), yangwangReference())).toBeNull();
  });
});
