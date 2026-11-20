import { readSamples } from '@gt7/capture';
import { describe, expect, it } from 'vitest';
import { SAMPLE_CACHE_MAX_SAMPLES, SampleCache } from '../../src/captures/sample-cache.js';
import { fixturePath } from '../../../../tools/testing/fixture-path.js';

const range = { first: 5100, last: 5199 };
const tiny = { first: 5100, last: 5105 };

describe('sample cache', () => {
  it('forget_drops_only_the_entries_of_that_capture', async () => {
    const cache = new SampleCache();
    const pathA = fixturePath('ce-slow');
    const pathB = fixturePath('ce-pause');
    const first = cache.read('a', pathA);
    await Promise.all([first, cache.read('a', pathA, { first: 1, last: 5 }), cache.read('b', pathB)]);
    cache.forget('a');
    expect(cache.size).toBe(1);
    const again = cache.read('a', pathA);
    expect(again).not.toBe(first);
    await again;
  });

  it('range_is_cut_from_a_cached_full_capture', async () => {
    const cache = new SampleCache();
    const path = fixturePath('demo-a');
    const full = await cache.read('a', path);
    for (const range of [{ first: 457, last: 1422 }, { first: 0, last: 300 }, { first: 600, last: 1200 }]) {
      const cut = await cache.read('a', path, range);
      expect(cut).toEqual(await readSamples(path, range));
      expect(cut[0]).toBe(full.find(sample => sample.rawIndex >= range.first));
    }
    expect(cache.size).toBe(1);
  });

  it('range_after_the_clock_warm_up_is_read_from_the_file', async () => {
    const cache = new SampleCache();
    const path = fixturePath('ce-pause');
    const range = { first: 12500, last: 12600 };
    const early = { first: 11600, last: 11700 };
    await cache.read('a', path);
    const part = await cache.read('a', path, range);
    expect(part).toEqual(await readSamples(path, range));
    expect(cache.size).toBe(2);
    expect(await cache.read('a', path, early)).toEqual(await readSamples(path, early));
    expect(cache.size).toBe(2);
  });

  it('cache_evicts_by_total_samples', async () => {
    const cache = new SampleCache();
    expect(SAMPLE_CACHE_MAX_SAMPLES).toBe(400_000);
    const small = await readSamples(fixturePath('ce-slow'), range);
    cache.maxSamples = small.length * 2 + 1;
    const a = cache.read('a', fixturePath('ce-slow'), range);
    const b = cache.read('b', fixturePath('ce-slow'), range);
    await Promise.all([a, b]);
    expect(cache.totalSamples).toBe(small.length * 2);
    await cache.read('c', fixturePath('ce-slow'), range);
    expect(cache.size).toBe(2);
    expect(cache.totalSamples).toBe(small.length * 2);
    expect(cache.read('b', fixturePath('ce-slow'), range)).toBe(b);
    expect(cache.read('a', fixturePath('ce-slow'), range)).not.toBe(a);
  });

  it('entry_larger_than_the_limit_is_not_cached', async () => {
    const cache = new SampleCache();
    cache.maxSamples = 10;
    const keep = cache.read('a', fixturePath('ce-slow'), tiny);
    await keep;
    const big = await cache.read('b', fixturePath('ce-slow'), range);
    expect(big.length).toBeGreaterThan(10);
    expect(cache.size).toBe(1);
    expect(cache.totalSamples).toBeLessThanOrEqual(10);
    expect(cache.read('a', fixturePath('ce-slow'), tiny)).toBe(keep);
  });
});
