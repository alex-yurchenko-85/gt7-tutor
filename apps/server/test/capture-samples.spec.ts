import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSamples } from '../src/captures/capture-samples.js';

const PAUSE_RUN = fileURLToPath(new URL('../../../fixtures/ce-pause.ndjson', import.meta.url));

describe('readSamples', () => {
  it('read_samples_gives_the_times_of_the_clock_from_the_capture_start', async () => {
    const all = await readSamples(PAUSE_RUN);
    const part = await readSamples(PAUSE_RUN, { first: 12500, last: 12600 });
    expect(part.length).toBeGreaterThan(50);
    expect(part[0]!.rawIndex).toBeGreaterThanOrEqual(12500);
    expect(part.at(-1)!.rawIndex).toBeLessThanOrEqual(12600);
    const byIndex = new Map(all.map(sample => [sample.rawIndex, sample.clockMs!]));
    const first = part[0]!;
    for (const sample of part) {
      expect(sample.clockMs).toBeDefined();
      const live = byIndex.get(sample.rawIndex)! - byIndex.get(first.rawIndex)!;
      expect(Math.abs(sample.clockMs! - first.clockMs! - live)).toBeLessThan(0.01);
    }
  });
});
