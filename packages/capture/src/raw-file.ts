import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Writable } from 'node:stream';
import { rawDatagramSchema, type RawDatagram } from '@gt7/contracts';
import { DEFAULT_CONFIG } from '@gt7/core';
import type { Datagram } from './datagram.ts';

export type RawWriteResult = { complete: boolean; reason: string | null; packets: number };

export type RawRange = { first: number; last: number };

export type OpenStream = (path: string) => Writable;

const openExclusive: OpenStream = path => createWriteStream(path, { flags: 'wx' });

export class RawWriter {
  private readonly stream: Writable;
  private readonly captureId: string;
  private readonly maxQueueBytes: number;
  private nextRawIndex = 0;
  private written = 0;
  private failure: string | null = null;
  private writeFailed = false;
  private closing: Promise<RawWriteResult> | null = null;

  constructor(path: string, captureId: string, maxQueueBytes = DEFAULT_CONFIG.rawQueueBytes, open: OpenStream = openExclusive) {
    this.captureId = captureId;
    this.maxQueueBytes = maxQueueBytes;
    this.stream = open(path);
    this.stream.on('error', error => this.markWriteFailure(error));
  }

  get incompleteReason(): string | null {
    return this.failure;
  }

  append(datagram: Datagram): boolean {
    const rawIndex = this.nextRawIndex++;
    if (this.writeFailed || this.closing) return false;
    const line = this.toLine(datagram, rawIndex);
    if (this.stream.writableLength + Buffer.byteLength(line) > this.maxQueueBytes) {
      this.failure ??= 'queue-full';
      return false;
    }
    this.stream.write(line);
    this.written++;
    return true;
  }

  close(): Promise<RawWriteResult> {
    this.closing ??= new Promise(resolve => {
      const finish = () => resolve({ complete: this.failure === null, reason: this.failure, packets: this.written });
      if (this.stream.destroyed) return finish();
      this.stream.once('close', finish);
      this.stream.end();
    });
    return this.closing;
  }

  private markWriteFailure(error: Error) {
    this.writeFailed = true;
    this.failure = `write-error: ${error.message}`;
  }

  private toLine(datagram: Datagram, rawIndex: number): string {
    const row: RawDatagram = {
      schemaVersion: 1,
      captureId: this.captureId,
      rawIndex,
      receivedMonoMs: datagram.receivedMonoMs,
      receivedUnixMs: datagram.receivedUnixMs,
      peerIp: datagram.peerIp,
      payloadBase64: Buffer.from(datagram.payload.buffer, datagram.payload.byteOffset, datagram.payload.byteLength).toString('base64')
    };
    return JSON.stringify(row) + '\n';
  }
}

function parseRow(text: string): RawDatagram | null {
  try {
    const parsed = rawDatagramSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

type PendingLine = { text: string; lineNumber: number };

export async function* readRaw(path: string, range?: RawRange): AsyncIterable<RawDatagram> {
  const input = createReadStream(path);
  const lines = createInterface({ input, crlfDelay: Infinity });
  const isBeforeRange = (row: RawDatagram) => range !== undefined && row.rawIndex < range.first;
  const isAfterRange = (row: RawDatagram) => range !== undefined && row.rawIndex > range.last;
  let pending: PendingLine | null = null;
  let lineNumber = 0;
  try {
    for await (const text of lines) {
      lineNumber++;
      if (text.trim() === '') continue;
      if (pending) {
        const row = parseRow(pending.text);
        if (row === null) throw new Error(`Invalid raw row at line ${pending.lineNumber} of ${path}`);
        if (isAfterRange(row)) return;
        if (!isBeforeRange(row)) yield row;
      }
      pending = { text, lineNumber };
    }
    const last = pending ? parseRow(pending.text) : null;
    if (last && !isBeforeRange(last) && !isAfterRange(last)) yield last;
  } finally {
    lines.close();
    input.destroy();
  }
}
