import { readRaw, type RawRange } from '@gt7/capture';
import type { Sample } from '@gt7/contracts';
import { clockWarmupStart, toSample, withPacketClock } from '@gt7/core';

export async function readSamples(path: string, range?: RawRange): Promise<Sample[]> {
  const samples: Sample[] = [];
  const withWarmup = range === undefined ? undefined : { first: clockWarmupStart(range.first), last: range.last };
  for await (const row of readRaw(path, withWarmup)) {
    const sample = toSample(row);
    if (sample) samples.push(sample);
  }
  const clocked = withPacketClock(samples);
  return range === undefined ? clocked : clocked.filter(sample => sample.rawIndex >= range.first);
}

export async function countRows(path: string): Promise<number> {
  let rows = 0;
  for await (const _row of readRaw(path)) rows++;
  return rows;
}
