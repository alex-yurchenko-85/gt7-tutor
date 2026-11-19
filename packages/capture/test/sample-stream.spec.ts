import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawDatagram, Sample } from '@gt7/contracts';
import { RawWriter, SampleStream, readRaw, readSamples, type Datagram } from '../src/index.ts';
import { collect } from './helpers.ts';
import { fixturePath } from '../../../tools/testing/fixture-path.ts';
import { testTempDir } from '../../../tools/testing/temp-root.ts';

function datagramOf(row: RawDatagram, delayMs = 0): Datagram {
  return {
    payload: new Uint8Array(Buffer.from(row.payloadBase64, 'base64')),
    receivedMonoMs: row.receivedMonoMs + delayMs,
    receivedUnixMs: row.receivedUnixMs + delayMs,
    peerIp: row.peerIp
  };
}

function withRepeats(rows: RawDatagram[]): Datagram[] {
  const datagrams: Datagram[] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    const next = rows[index + 1];
    if (index % 97 === 50 && next) {
      datagrams.push(datagramOf(next), datagramOf(row, 1));
      index++;
      continue;
    }
    datagrams.push(datagramOf(row));
    if (index % 50 === 10) datagrams.push(datagramOf(row, 0.5));
    if (index % 211 === 30) datagrams.push(datagramOf(rows[Math.max(0, index - 20)]!, 2));
  }
  return datagrams;
}

describe('SampleStream', () => {
  it('file_and_live_samples_are_equal_for_a_fixture_with_repeats', async () => {
    const rows = await collect(readRaw(fixturePath('ce-pause')));
    const datagrams = withRepeats(rows);
    const path = join(testTempDir('gt7-capture-'), 'capture.ndjson');
    const writer = new RawWriter(path, 'capture-1');
    const stream = new SampleStream({ warmupFrom: 0 });
    const live: Sample[] = [];
    for (const datagram of datagrams) {
      const rawIndex = writer.append(datagram);
      const sample = stream.push({ rawIndex, receivedMonoMs: datagram.receivedMonoMs, payload: datagram.payload });
      if (sample) live.push(sample);
    }
    expect(await writer.close()).toMatchObject({ complete: true, packets: datagrams.length });
    const file = await readSamples(path);
    expect(file).toEqual(live);
    expect(live.length).toBeLessThan(datagrams.length);
    const packetIds = live.map(sample => sample.packetId);
    expect(new Set(packetIds).size).toBe(packetIds.length);
    expect(packetIds.every((packetId, index) => index === 0 || packetId > packetIds[index - 1]!)).toBe(true);
    expect(live.every(sample => sample.clockMs !== undefined)).toBe(true);
  });

  it('rows_before_warmup_from_give_no_sample_but_set_the_clock', async () => {
    const rows = (await collect(readRaw(fixturePath('ce-pause')))).slice(0, 40);
    const all = new SampleStream({ warmupFrom: 0 });
    const part = new SampleStream({ warmupFrom: rows[20]!.rawIndex });
    for (const row of rows) {
      const input = { rawIndex: row.rawIndex, receivedMonoMs: row.receivedMonoMs, payload: datagramOf(row).payload };
      const expected = all.push(input);
      const sample = part.push(input);
      expect(sample).toEqual(row.rawIndex < rows[20]!.rawIndex ? null : expected);
    }
  });

  it('undecodable_row_gives_no_sample', () => {
    const stream = new SampleStream({ warmupFrom: 0 });
    expect(stream.push({ rawIndex: 0, receivedMonoMs: 0, payload: new Uint8Array(100) })).toBeNull();
  });
});
