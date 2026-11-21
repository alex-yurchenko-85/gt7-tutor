import { readFileSync } from 'node:fs';
import type { RawDatagram, Sample } from '@gt7/contracts';
import { fixturePath } from '../../../tools/testing/fixture-path.ts';
import { toSample } from '../src/decode.ts';
import { withPacketClock } from '../src/packet-clock.ts';

export type FixtureName = 'b3-run' | 'b1-run' | 'ce-clean' | 'ce-slow' | 'ce-pause' | 'ce-off-track-reset' | 'ce-off-track-end' | 'demo-a' | 'demo-b' | 'demo-c' | 'race-grid-start' | 'race-lap-line' | 'race-finish' | 'race-pit-stop' | 'race-off-track';

export function readFixture(name: FixtureName): RawDatagram[] {
  return readFileSync(fixturePath(name), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as RawDatagram);
}

export function payloadOf(raw: RawDatagram): Uint8Array {
  return new Uint8Array(Buffer.from(raw.payloadBase64, 'base64'));
}

const sampleCache = new Map<FixtureName, Sample[]>();

export function samplesOf(name: FixtureName): Sample[] {
  const cached = sampleCache.get(name);
  if (cached) return cached;
  const samples = readFixture(name).map(raw => {
    const sample = toSample(raw);
    if (!sample) throw new Error(`${name} row ${raw.rawIndex} does not decode`);
    return sample;
  });
  const clocked = withPacketClock(samples);
  sampleCache.set(name, clocked);
  return clocked;
}

export function between(samples: Sample[], first: number, last: number): Sample[] {
  return samples.filter(sample => sample.rawIndex >= first && sample.rawIndex <= last);
}
