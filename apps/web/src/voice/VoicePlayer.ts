import type { ClientMsg, CueOutcome, LiveCue, ServerMsg } from '@gt7/contracts';
import { VOICE_CHECK_CLIP } from './clips.ts';

export type VoiceSource = {
  buffer: unknown;
  connect(destination: unknown): unknown;
  start(when?: number): void;
  stop(when?: number): void;
  onended: (() => void) | null;
};

export type VoiceContext = {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: unknown;
  readonly outputLatency?: number;
  readonly baseLatency?: number;
  resume(): Promise<void>;
  decodeAudioData(data: ArrayBuffer): Promise<unknown>;
  createBuffer(channels: number, length: number, sampleRate: number): unknown;
  createBufferSource(): VoiceSource;
};

export type VoicePlayerOptions = {
  createContext: () => VoiceContext;
  fetch: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;
  now: () => number;
  report: (message: ClientMsg) => void;
  audioBase?: string;
};

type Manifest = { clips: Record<string, { file: string; durationMs: number }> };

type Playing = { sources: VoiceSource[]; cueId: string | null; generation: number };

const CLOCK_SAMPLES = 30;

export type VoiceTestResult = { reportedLatencyMs: number };

export class VoicePlayer {
  private context: VoiceContext | null = null;
  private manifest: Promise<Manifest> | null = null;
  private readonly buffers = new Map<string, unknown>();
  private playing: Playing | null = null;
  private newestGeneration = 0;
  private readonly clockSkews: number[] = [];
  private readonly audioBase: string;
  private readonly options: VoicePlayerOptions;

  constructor(options: VoicePlayerOptions) {
    this.options = options;
    this.audioBase = options.audioBase ?? '/audio/';
  }

  get ready(): boolean {
    return this.context?.state === 'running';
  }

  outputLatencyMs(): number {
    const context = this.context;
    if (!context) return 0;
    return Math.round(((context.outputLatency || 0) + (context.baseLatency || 0)) * 1000);
  }

  async unlock(): Promise<void> {
    const context = this.ensureContext();
    await context.resume();
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, 22050);
    source.connect(context.destination);
    source.start();
  }

  async preload(keys: string[]): Promise<void> {
    const manifest = await this.loadManifest();
    const context = this.ensureContext();
    await Promise.all(
      keys
        .filter(key => !this.buffers.has(key))
        .map(async key => {
          const entry = manifest.clips[key];
          if (!entry) throw new Error(`No clip for ${key}`);
          const response = await this.options.fetch(`${this.audioBase}${entry.file}`);
          if (!response.ok) throw new Error(`Clip ${key} did not load`);
          this.buffers.set(key, await context.decodeAudioData(await response.arrayBuffer()));
        })
    );
  }

  hasClip(key: string): boolean {
    return this.buffers.has(key);
  }

  handle(message: ServerMsg, receivedAt: number = this.options.now()): void {
    if (message.type === 'state') this.noteGeneration(message.state.generation);
    else if (message.type === 'cancel') this.cancel(message.generation);
    else if (message.type === 'ping') this.noteClock(message.serverMs, receivedAt);
    else this.playCue(message.cue, receivedAt, message.sentMs);
  }

  async test(): Promise<VoiceTestResult> {
    await this.unlock();
    await this.preload([VOICE_CHECK_CLIP]);
    this.start([this.buffers.get(VOICE_CHECK_CLIP)], null, this.newestGeneration);
    return { reportedLatencyMs: this.outputLatencyMs() };
  }

  async preview(...clips: string[]): Promise<void> {
    await this.unlock();
    await this.preload(clips);
    this.start(clips.map(clip => this.buffers.get(clip)), null, this.newestGeneration);
  }

  stop(): void {
    for (const source of this.playing?.sources ?? []) source.stop();
    this.playing = null;
  }

  private ensureContext(): VoiceContext {
    this.context ??= this.options.createContext();
    return this.context;
  }

  private loadManifest(): Promise<Manifest> {
    this.manifest ??= this.options
      .fetch(`${this.audioBase}manifest.json`)
      .then(async response => {
        if (!response.ok) throw new Error('The clip list did not load');
        return (await response.json()) as Manifest;
      })
      .catch(error => {
        this.manifest = null;
        throw error;
      });
    return this.manifest;
  }

  private noteClock(serverMs: number, receivedAt: number): void {
    this.clockSkews.push(receivedAt - serverMs);
    if (this.clockSkews.length > CLOCK_SAMPLES) this.clockSkews.shift();
  }

  private deliveryDelayMs(sentMs: number, receivedAt: number): number {
    if (this.clockSkews.length === 0) return 0;
    return Math.max(0, receivedAt - sentMs - Math.min(...this.clockSkews));
  }

  private noteGeneration(generation: number): void {
    this.newestGeneration = Math.max(this.newestGeneration, generation);
  }

  private cancel(generation: number): void {
    if (this.playing && this.playing.generation <= generation) this.stop();
  }

  private outcome(cue: LiveCue, outcome: CueOutcome, startDelayMs: number | null): void {
    this.options.report({ type: 'cue-outcome', cueId: cue.id, outcome, startDelayMs });
  }

  private playCue(cue: LiveCue, receivedAt: number, sentMs: number): void {
    if (cue.generation < this.newestGeneration) {
      this.outcome(cue, 'cancelled', null);
      return;
    }
    this.noteGeneration(cue.generation);
    const waitedMs = this.deliveryDelayMs(sentMs, receivedAt) + this.options.now() - receivedAt;
    if (waitedMs > cue.ttlMs) {
      this.outcome(cue, 'expired', null);
      return;
    }
    const buffers = [cue.clip, ...(cue.followClip ? [cue.followClip] : [])].map(clip => this.buffers.get(clip));
    if (!this.ready || buffers.some(buffer => buffer === undefined)) {
      this.outcome(cue, 'failed', null);
      return;
    }
    try {
      this.start(buffers, cue.id, cue.generation);
    } catch {
      this.outcome(cue, 'failed', null);
      return;
    }
    this.outcome(cue, 'played', Math.max(0, Math.round(this.options.now() - receivedAt)) + this.outputLatencyMs());
  }

  private start(buffers: unknown[], cueId: string | null, generation: number): void {
    const context = this.ensureContext();
    this.stop();
    const sources = buffers.map(buffer => {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      return source;
    });
    const playing: Playing = { sources, cueId, generation };
    sources.at(-1)!.onended = () => {
      if (this.playing === playing) this.playing = null;
    };
    let followAt = context.currentTime;
    sources.forEach((source, index) => {
      if (index === 0) source.start();
      else source.start(followAt);
      followAt += durationOf(buffers[index]);
    });
    this.playing = playing;
  }
}

function durationOf(buffer: unknown): number {
  const duration = (buffer as { duration?: unknown }).duration;
  return typeof duration === 'number' && Number.isFinite(duration) ? duration : 0;
}

export function browserVoicePlayer(report: (message: ClientMsg) => void): VoicePlayer {
  return new VoicePlayer({
    createContext: () => new AudioContext({ latencyHint: 'interactive' }) as unknown as VoiceContext,
    fetch: url => fetch(url, { credentials: 'same-origin' }),
    now: () => performance.now(),
    report
  });
}
