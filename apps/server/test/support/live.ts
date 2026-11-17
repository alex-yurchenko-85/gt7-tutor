import type { RawDatagram, ServerMsg } from '@gt7/contracts';
import { readRaw, type DatagramHandler, type TelemetrySource } from '@gt7/capture';
import { WebSocket } from 'ws';
import { fixturePath } from './replay-sources.js';

export class LiveConnection {
  readonly messages: ServerMsg[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  readonly socket: WebSocket;

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', data => this.messages.push(JSON.parse(String(data)) as ServerMsg));
    this.closed = new Promise(resolve => socket.once('close', (code, reason) => resolve({ code, reason: String(reason) })));
  }

  send(message: object): void {
    this.socket.send(JSON.stringify(message));
  }

  of<T extends ServerMsg['type']>(type: T): Extract<ServerMsg, { type: T }>[] {
    return this.messages.filter((message): message is Extract<ServerMsg, { type: T }> => message.type === type);
  }

  async waitFor<T extends ServerMsg['type']>(
    type: T,
    predicate: (message: Extract<ServerMsg, { type: T }>) => boolean = () => true,
    timeoutMs = 5000
  ): Promise<Extract<ServerMsg, { type: T }>> {
    const found = await eventually(() => this.of(type).find(predicate), timeoutMs);
    return found;
  }

  close(): Promise<{ code: number; reason: string }> {
    this.socket.close();
    return this.closed;
  }
}

export function openLive(port: number, cookie?: string, headers: Record<string, string> = {}): Promise<LiveConnection> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/live`, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });
  const connection = new LiveConnection(socket);
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(connection));
    socket.once('error', reject);
  });
}

export async function eventually<T>(probe: () => T | undefined | null | false | Promise<T | undefined | null | false>, timeoutMs = 5000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`Condition not met within ${timeoutMs} ms`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

export class TestClock {
  manual: number | null = null;

  now(): number {
    return this.manual ?? performance.now();
  }
}

export async function fixtureRows(name: string): Promise<RawDatagram[]> {
  const rows: RawDatagram[] = [];
  for await (const row of readRaw(fixturePath(name))) rows.push(row);
  return rows;
}

export class ManualSource implements TelemetrySource {
  private handler: DatagramHandler | null = null;

  async start(on: DatagramHandler): Promise<void> {
    this.handler = on;
  }

  async stop(): Promise<void> {
    this.handler = null;
  }

  emit(rows: RawDatagram[], offsetMs = 0): void {
    for (const row of rows) {
      this.handler?.({
        payload: new Uint8Array(Buffer.from(row.payloadBase64, 'base64')),
        receivedMonoMs: row.receivedMonoMs + offsetMs,
        receivedUnixMs: row.receivedUnixMs,
        peerIp: row.peerIp
      });
    }
  }
}
