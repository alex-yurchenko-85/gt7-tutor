import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RawDatagram, Sample } from '@gt7/contracts';
import { toSample } from '../src/decode.ts';
import { withPacketClock } from '../src/packet-clock.ts';

export type FixtureName = 'b3-run' | 'b1-run' | 'ce-clean' | 'ce-slow' | 'ce-pause' | 'ce-off-track-reset' | 'ce-off-track-end' | 'demo-a' | 'demo-b' | 'demo-c';

export function fixturePath(name: FixtureName): string {
  return fileURLToPath(new URL(`../../../fixtures/${name}.ndjson`, import.meta.url));
}

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
