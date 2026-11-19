import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSamples } from '../src/index.ts';
import { fixturePath } from '../../../tools/testing/fixture-path.ts';
import { testTempDir } from '../../../tools/testing/temp-root.ts';

const PAUSE_RUN = fixturePath('ce-pause');

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

  it('range_read_skips_rows_before_the_range_without_parsing_them', async () => {
    const lines = readFileSync(PAUSE_RUN, 'utf8').split('\n').slice(0, 1100);
    const range = { first: 12500, last: 12520 };
    const expected = await readSamples(PAUSE_RUN, range);
    expect(expected.length).toBeGreaterThan(10);
    const dir = testTempDir('gt7-capture-');
    const corrupt = (name: string, at: number) => {
      const path = join(dir, name);
      writeFileSync(path, [...lines.slice(0, at), `{"schemaVersion":1,"rawIndex":${11540 + at},"receivedMonoMs":`, ...lines.slice(at + 1)].join('\n') + '\n');
      return path;
    };
    expect(await readSamples(corrupt('before.ndjson', 3), range)).toEqual(expected);
    await expect(readSamples(corrupt('warmup.ndjson', 410), range)).rejects.toThrow('Invalid raw row at line 411');
    await expect(readSamples(corrupt('range.ndjson', 970), range)).rejects.toThrow('Invalid raw row at line 971');
  });
});
