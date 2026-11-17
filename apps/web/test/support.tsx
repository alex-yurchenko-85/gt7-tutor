import { render } from '@testing-library/react';
import { vi } from 'vitest';
import type { ClientMsg, LiveCue, LiveState, ServerMsg } from '@gt7/contracts';
import { App } from '../src/app/App.tsx';
import type { LiveSocket, SocketFactory } from '../src/api/live.tsx';
import { VoicePlayer, type VoiceContext, type VoiceSource } from '../src/voice/VoicePlayer.ts';

export type Reply = { status?: number; body?: unknown };
export type Handler = (body: unknown, url: URL) => Reply | unknown;

export class ApiStub {
  readonly calls: { method: string; path: string; body: unknown }[] = [];
  private readonly routes = new Map<string, Handler>();

  on(route: string, handler: Handler | unknown): this {
    this.routes.set(route, typeof handler === 'function' ? (handler as Handler) : () => handler);
    return this;
  }

  install(): this {
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      this.calls.push({ method, path: url.pathname, body });
      const handler = this.routes.get(`${method} ${url.pathname}`);
      if (!handler) return jsonResponse(404, { message: `No stub for ${method} ${url.pathname}` });
      const result = await handler(body, url);
      const reply = isReply(result) ? result : { body: result };
      return jsonResponse(reply.status ?? 200, reply.body);
    });
    return this;
  }

  called(route: string): boolean {
    return this.calls.some(call => `${call.method} ${call.path}` === route);
  }
}

function isReply(value: unknown): value is Reply {
  return typeof value === 'object' && value !== null && ('status' in value || 'body' in value) && Object.keys(value).every(key => key === 'status' || key === 'body');
}

function jsonResponse(status: number, body: unknown) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
    arrayBuffer: async () => new ArrayBuffer(8)
  };
}

export class FakeSocket implements LiveSocket {
  readyState = 0;
  readonly sent: ClientMsg[] = [];
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientMsg);
  }

  close(code = 1000): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(message: ServerMsg): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

export class FakeSockets {
  readonly sockets: FakeSocket[] = [];
  readonly factory: SocketFactory = () => {
    const socket = new FakeSocket();
    this.sockets.push(socket);
    return socket;
  };

  get latest(): FakeSocket {
    const socket = this.sockets.at(-1);
    if (!socket) throw new Error('No socket was opened');
    return socket;
  }
}

export class FakeSource implements VoiceSource {
  buffer: unknown = null;
  started = 0;
  stopped = 0;
  startedAt: number | null = null;
  onended: (() => void) | null = null;

  connect(): unknown {
    return null;
  }

  start(when = 0): void {
    this.started++;
    this.startedAt = when;
  }

  stop(): void {
    this.stopped++;
  }
}

export class FakeAudio implements VoiceContext {
  state = 'suspended';
  readonly destination = {};
  outputLatency = 0.02;
  baseLatency = 0.005;
  currentTime = 4;
  readonly sources: FakeSource[] = [];

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async decodeAudioData(data: ArrayBuffer): Promise<unknown> {
    return { decoded: data.byteLength, duration: data.byteLength / 100 };
  }

  createBuffer(): unknown {
    return { silent: true };
  }

  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  played(): FakeSource[] {
    return this.sources.filter(source => source.buffer !== null && (source.buffer as { silent?: boolean }).silent !== true && source.started > 0);
  }
}

export const MANIFEST = {
  schemaVersion: 1,
  clips: {
    'voice-check': { file: 'clips/voice-check.wav', durationMs: 700 },
    'brake-80': { file: 'clips/brake-80.wav', durationMs: 1000 },
    'throttle-120': { file: 'clips/throttle-120.wav', durationMs: 1200 },
    'hard-brake': { file: 'clips/hard-brake.wav', durationMs: 766 },
    'speed-85': { file: 'clips/speed-85.wav', durationMs: 700 }
  }
};

export function audioFetch(manifest = MANIFEST) {
  return async (url: string) => ({
    ok: true,
    json: async () => manifest,
    arrayBuffer: async () => new ArrayBuffer(url.length)
  });
}

export type PlayerRig = { player: VoicePlayer; audio: FakeAudio; reports: ClientMsg[]; clock: { now: number } };

export function playerRig(): PlayerRig {
  const audio = new FakeAudio();
  const reports: ClientMsg[] = [];
  const clock = { now: 1000 };
  const player = new VoicePlayer({ createContext: () => audio, fetch: audioFetch(), now: () => clock.now, report: message => reports.push(message) });
  return { player, audio, reports, clock };
}

export function cue(overrides: Partial<LiveCue> = {}): LiveCue {
  return {
    id: 'cue-1',
    eventKey: 'brake-412',
    kind: 'brake',
    targetSpeedKph: 80,
    clip: 'brake-80',
    followClip: null,
    generation: 5,
    priority: 100,
    decidedMonoMs: 12000,
    ttlMs: 210,
    ...overrides
  };
}

export function liveState(overrides: Partial<LiveState> = {}): LiveState {
  return {
    seq: 1,
    connection: 'disconnected',
    mode: 'idle',
    exerciseId: null,
    attemptNumber: null,
    generation: 5,
    guidance: { mode: 'active', reason: null },
    voiceDeviceId: null,
    voiceReady: false,
    recordingComplete: true,
    storageError: null,
    sM: null,
    speedKph: null,
    lastCue: null,
    nextCue: null,
    lastAttemptId: null,
    trainingMode: null,
    referenceId: null,
    ...overrides
  };
}

export function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  vi.stubGlobal('matchMedia', (query: string) => {
    const minimum = /min-width:\s*(\d+)px/.exec(query);
    const matches = minimum ? width >= Number(minimum[1]) : false;
    return { matches, media: query, addEventListener: () => undefined, removeEventListener: () => undefined };
  });
}

export const USER = { id: 'user-1', name: 'Driver' };

export function signedIn(api: ApiStub): ApiStub {
  return api.on('GET /api/auth/state', { hasUsers: true, user: USER });
}

export function renderApp(options: { path?: string; sockets?: FakeSockets; player?: VoicePlayer } = {}) {
  window.history.replaceState(null, '', options.path ?? '/');
  const sockets = options.sockets ?? new FakeSockets();
  const view = render(<App socketFactory={sockets.factory} {...(options.player ? { player: options.player } : {})} />);
  return { ...view, sockets };
}
