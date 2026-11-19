import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { RawWriter, readRaw, type Datagram } from '../src/index.ts';
import { collect } from './helpers.ts';
import { testTempDir } from '../../../tools/testing/temp-root.ts';

function datagram(bytes: number[], receivedMonoMs: number): Datagram {
  return { payload: Uint8Array.from(bytes), receivedMonoMs, receivedUnixMs: 1_800_000_000_000 + receivedMonoMs, peerIp: '0.0.0.0' };
}

class BlockedStream extends Writable {
  private pending: (() => void)[] = [];
  override _write(_chunk: unknown, _encoding: BufferEncoding, callback: () => void) {
    this.pending.push(callback);
  }
  release() {
    for (const callback of this.pending.splice(0)) callback();
  }
}

describe('raw files', () => {
  it('raw_file_bytes_are_the_json_rows', async () => {
    const path = join(testTempDir('gt7-capture-'), 'capture.ndjson');
    const writer = new RawWriter(path, 'capture-1');
    const written = [datagram([0, 1, 2, 255], 1.5), { ...datagram([7, 8], 18.25), peerIp: '192.0.2.1' }, datagram([], 1e21)];
    for (const d of written) writer.append(d);
    await writer.close();
    const expected = written
      .map((d, rawIndex) =>
        JSON.stringify({
          schemaVersion: 1,
          captureId: 'capture-1',
          rawIndex,
          receivedMonoMs: d.receivedMonoMs,
          receivedUnixMs: d.receivedUnixMs,
          peerIp: d.peerIp,
          payloadBase64: Buffer.from(d.payload).toString('base64')
        }) + '\n'
      )
      .join('');
    expect(readFileSync(path, 'utf8')).toBe(expected);
  });

  it('raw_round_trip_is_exact', async () => {
    const path = join(testTempDir('gt7-capture-'), 'capture.ndjson');
    const writer = new RawWriter(path, 'capture-1');
    const written = [datagram([0, 1, 2, 255], 1.5), datagram([7], 18.25), datagram([], 33)];
    for (const d of written) writer.append(d);
    expect(await writer.close()).toEqual({ complete: true, reason: null, packets: 3 });
    const rows = await collect(readRaw(path));
    expect(rows.map(row => row.rawIndex)).toEqual([0, 1, 2]);
    expect(rows.map(row => [...Buffer.from(row.payloadBase64, 'base64')])).toEqual(written.map(d => [...d.payload]));
    expect(rows.map(row => row.receivedMonoMs)).toEqual([1.5, 18.25, 33]);
    expect(rows.every(row => row.captureId === 'capture-1' && row.schemaVersion === 1)).toBe(true);
  });

  it('range_is_inclusive', async () => {
    const path = join(testTempDir('gt7-capture-'), 'capture.ndjson');
    const writer = new RawWriter(path, 'capture-1');
    for (let i = 0; i < 6; i++) writer.append(datagram([i], i));
    await writer.close();
    const rows = await collect(readRaw(path, { first: 2, last: 4 }));
    expect(rows.map(row => row.rawIndex)).toEqual([2, 3, 4]);
  });

  it('full_queue_reports_incomplete', async () => {
    const stream = new BlockedStream();
    const writer = new RawWriter('unused', 'capture-1', { maxQueueBytes: 1024, open: () => stream });
    const results: boolean[] = [];
    for (let i = 0; i < 20; i++) {
      writer.append(datagram(new Array(296).fill(i), i));
      results.push(writer.incompleteReason === null);
    }
    expect(results[0]).toBe(true);
    expect(results.at(-1)).toBe(false);
    stream.release();
    const closing = writer.close();
    stream.release();
    const result = await closing;
    expect(result.complete).toBe(false);
    expect(result.reason).toBe('queue-full');
    expect(result.packets).toBe(results.filter(Boolean).length);
  });

  it('append_returns_consecutive_raw_indexes', async () => {
    const stream = new BlockedStream();
    const writer = new RawWriter('unused', 'capture-1', { maxQueueBytes: 1024, open: () => stream });
    const indexes: number[] = [];
    for (let i = 0; i < 6; i++) indexes.push(writer.append(datagram(new Array(296).fill(i), i)));
    expect(writer.incompleteReason).toBe('queue-full');
    expect(indexes).toEqual([0, 1, 2, 3, 4, 5]);
    expect(writer.appended).toBe(6);
    stream.release();
    const closing = writer.close();
    stream.release();
    await closing;
    expect(writer.append(datagram([1], 99))).toBe(6);
  });

  it('write_error_never_throws_and_reports_incomplete', async () => {
    const path = join(testTempDir('gt7-capture-'), 'missing-dir', 'capture.ndjson');
    const writer = new RawWriter(path, 'capture-1');
    expect(() => writer.append(datagram([1], 1))).not.toThrow();
    const result = await writer.close();
    expect(result.complete).toBe(false);
    expect(result.reason).toMatch(/^write-error/);
  });

  it('truncated_last_row_keeps_earlier_rows', async () => {
    const path = join(testTempDir('gt7-capture-'), 'capture.ndjson');
    const writer = new RawWriter(path, 'capture-1');
    for (let i = 0; i < 4; i++) writer.append(datagram([i], i));
    await writer.close();
    const text = readFileSync(path, 'utf8');
    writeFileSync(path, text.slice(0, text.length - 20));
    const rows = await collect(readRaw(path));
    expect(rows.map(row => row.rawIndex)).toEqual([0, 1, 2]);
  });

  it('corrupt_middle_row_is_an_error', async () => {
    const path = join(testTempDir('gt7-capture-'), 'capture.ndjson');
    const writer = new RawWriter(path, 'capture-1');
    writer.append(datagram([1], 1));
    await writer.close();
    appendFileSync(path, '{"broken\n');
    appendFileSync(path, readFileSync(path, 'utf8').split('\n')[0] + '\n');
    await expect(collect(readRaw(path))).rejects.toThrow(/line 2/);
  });
});
