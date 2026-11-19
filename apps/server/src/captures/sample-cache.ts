import { Injectable } from '@nestjs/common';
import { readSamples } from '@gt7/capture';
import type { RawRange, Sample } from '@gt7/contracts';
import { clockWarmupStart } from '@gt7/core';

export const SAMPLE_CACHE_MAX_SAMPLES = 400_000;

type Entry = { samples: Promise<Sample[]>; count: number };

function lowerBound(samples: Sample[], rawIndex: number): number {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (samples[middle]!.rawIndex < rawIndex) low = middle + 1;
    else high = middle;
  }
  return low;
}

@Injectable()
export class SampleCache {
  maxSamples = SAMPLE_CACHE_MAX_SAMPLES;
  private readonly entries = new Map<string, Entry>();
  private total = 0;

  read(captureId: string, path: string, range?: RawRange): Promise<Sample[]> {
    const key = range ? `${captureId}:${range.first}:${range.last}` : `${captureId}:all`;
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.samples;
    }
    const full = range ? this.entries.get(`${captureId}:all`) : undefined;
    if (range && full) return full.samples.then(samples => this.cut(samples, range) ?? this.entries.get(key)?.samples ?? this.load(key, path, range));
    return this.load(key, path, range);
  }

  forget(captureId: string): void {
    const prefix = `${captureId}:`;
    for (const key of [...this.entries.keys()]) if (key.startsWith(prefix)) this.drop(key, this.entries.get(key)!);
  }

  get size(): number {
    return this.entries.size;
  }

  get totalSamples(): number {
    return this.total;
  }

  private load(key: string, path: string, range?: RawRange): Promise<Sample[]> {
    const loading = readSamples(path, range);
    const entry: Entry = { samples: loading, count: 0 };
    this.entries.set(key, entry);
    loading.then(
      samples => this.settle(key, entry, samples.length),
      () => this.drop(key, entry)
    );
    return loading;
  }

  private cut(samples: Sample[], range: RawRange): Sample[] | null {
    const start = samples[0]?.rawIndex;
    if (start === undefined || clockWarmupStart(range.first) > start) return null;
    return samples.slice(lowerBound(samples, range.first), lowerBound(samples, range.last + 1));
  }

  private settle(key: string, entry: Entry, count: number): void {
    if (this.entries.get(key) !== entry) return;
    if (count > this.maxSamples) return this.drop(key, entry);
    entry.count = count;
    this.total += count;
    for (const [oldKey, oldest] of this.entries) {
      if (this.total <= this.maxSamples) break;
      if (oldest !== entry) this.drop(oldKey, oldest);
    }
  }

  private drop(key: string, entry: Entry): void {
    if (this.entries.get(key) !== entry) return;
    this.entries.delete(key);
    this.total -= entry.count;
  }
}
