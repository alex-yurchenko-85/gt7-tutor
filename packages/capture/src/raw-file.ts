import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Writable } from 'node:stream';
import { rawDatagramSchema, type RawDatagram, type RawRange } from '@gt7/contracts';
import { CAPTURE_CONFIG } from './config.ts';
import type { Datagram } from './datagram.ts';

export type RawWriteResult = { complete: boolean; reason: string | null; packets: number };

export type OpenStream = (path: string) => Writable;

export type RawWriterOptions = { maxQueueBytes?: number; open?: OpenStream };

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

  constructor(path: string, captureId: string, options: RawWriterOptions = {}) {
    this.captureId = captureId;
    this.maxQueueBytes = options.maxQueueBytes ?? CAPTURE_CONFIG.rawQueueBytes;
    this.stream = (options.open ?? openExclusive)(path);
    this.stream.on('error', error => this.markWriteFailure(error));
  }

  get incompleteReason(): string | null {
    return this.failure;
  }

  get appended(): number {
    return this.nextRawIndex;
  }

  append(datagram: Datagram): number {
    const rawIndex = this.nextRawIndex++;
    if (!this.writeFailed && !this.closing) this.write(this.toLine(datagram, rawIndex));
    return rawIndex;
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

  private write(line: string) {
    if (this.stream.writableLength + line.length > this.maxQueueBytes) {
      this.failure ??= 'queue-full';
      return;
    }
    this.stream.write(line);
    this.written++;
  }

  private markWriteFailure(error: Error) {
    this.writeFailed = true;
    this.failure = `write-error: ${error.message}`;
  }

  private toLine(datagram: Datagram, rawIndex: number): string {
    const { payload } = datagram;
    const base64 = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).toString('base64');
    return `{"schemaVersion":1,"captureId":${JSON.stringify(this.captureId)},"rawIndex":${rawIndex},"receivedMonoMs":${datagram.receivedMonoMs},"receivedUnixMs":${datagram.receivedUnixMs},"peerIp":${JSON.stringify(datagram.peerIp)},"payloadBase64":"${base64}"}\n`;
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

const RAW_INDEX_KEY = '"rawIndex":';

function peekRawIndex(text: string): number | null {
  const start = text.indexOf(RAW_INDEX_KEY);
  if (start < 0) return null;
  let end = start + RAW_INDEX_KEY.length;
  while (end < text.length && text.charCodeAt(end) >= 48 && text.charCodeAt(end) <= 57) end++;
  const value = Number(text.slice(start + RAW_INDEX_KEY.length, end));
  return Number.isInteger(value) && text[end] === ',' ? value : null;
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
      if (range !== undefined && pending === null) {
        const peeked = peekRawIndex(text);
        if (peeked !== null && peeked < range.first) continue;
      }
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
