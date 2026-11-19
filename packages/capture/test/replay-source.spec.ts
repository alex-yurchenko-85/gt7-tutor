import { describe, expect, it } from 'vitest';
import { ReplaySource, type Datagram } from '../src/index.ts';
import { fixturePath } from '../../../tools/testing/fixture-path.ts';

describe('ReplaySource', () => {
  it('replay_speed_zero_is_ordered', async () => {
    const received: Datagram[] = [];
    const source = new ReplaySource({ path: fixturePath('ce-clean'), speed: 0 });
    await source.start(datagram => received.push(datagram));
    await source.finished;
    expect(received).toHaveLength(1631);
    for (let i = 1; i < received.length; i++) {
      expect(received[i]!.receivedMonoMs).toBeGreaterThanOrEqual(received[i - 1]!.receivedMonoMs);
    }
    expect(received[0]!.payload.byteLength).toBe(368);
  });

  it('replay_stop_ends_early', async () => {
    let count = 0;
    const source = new ReplaySource({ path: fixturePath('ce-clean'), speed: 0 });
    await source.start(() => {
      count++;
      if (count === 10) void source.stop();
    });
    await source.finished;
    expect(count).toBeLessThan(1631);
  });
});
