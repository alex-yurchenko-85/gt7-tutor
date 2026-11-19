import type { RawRange, Sample } from '@gt7/contracts';
import { clockWarmupStart } from '@gt7/core';
import { readRaw } from './raw-file.ts';
import { SampleStream } from './sample-stream.ts';

export async function readSamples(path: string, range?: RawRange): Promise<Sample[]> {
  const stream = new SampleStream({ warmupFrom: range?.first ?? 0 });
  const rows = range === undefined ? undefined : { first: clockWarmupStart(range.first), last: range.last };
  const samples: Sample[] = [];
  for await (const row of readRaw(path, rows)) {
    const sample = stream.push({ rawIndex: row.rawIndex, receivedMonoMs: row.receivedMonoMs, payload: Buffer.from(row.payloadBase64, 'base64') });
    if (sample) samples.push(sample);
  }
  return samples;
}
