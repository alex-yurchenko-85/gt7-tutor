import { readRaw, type RawRange } from '@gt7/capture';
import type { Sample } from '@gt7/contracts';
import { toSample } from '@gt7/core';

export async function readSamples(path: string, range?: RawRange): Promise<Sample[]> {
  const samples: Sample[] = [];
  for await (const row of readRaw(path, range)) {
    const sample = toSample(row);
    if (sample) samples.push(sample);
  }
  return samples;
}

export async function countRows(path: string): Promise<number> {
  let rows = 0;
  for await (const _row of readRaw(path)) rows++;
  return rows;
}
