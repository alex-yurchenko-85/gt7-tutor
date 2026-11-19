import { Injectable } from '@nestjs/common';
import type { RawRange } from '@gt7/capture';
import type { Sample } from '@gt7/contracts';
import { readSamples } from './capture-samples.js';

export const SAMPLE_CACHE_ENTRIES = 20;

@Injectable()
export class SampleCache {
  private readonly entries = new Map<string, Promise<Sample[]>>();

  read(captureId: string, path: string, range?: RawRange): Promise<Sample[]> {
    const key = range ? `${captureId}:${range.first}:${range.last}` : `${captureId}:all`;
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }
    const loading = readSamples(path, range);
    this.entries.set(key, loading);
    loading.catch(() => this.entries.delete(key));
    while (this.entries.size > SAMPLE_CACHE_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
    return loading;
  }

  forget(captureId: string): void {
    const prefix = `${captureId}:`;
    for (const key of [...this.entries.keys()]) if (key.startsWith(prefix)) this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}
