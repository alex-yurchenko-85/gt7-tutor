import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { ClientMsg, CueOutcome, LiveCue, LiveState, ServerMsg } from '@gt7/contracts';
import { MONO_CLOCK, type MonoClock } from '../clock/mono-clock.js';

export const STATE_INTERVAL_MS = 1000 / 15;
export const PING_INTERVAL_MS = 1000;
export const MAX_PENDING_BYTES = 256 * 1024;
export const UNMEASURED_DEVICE_DELAY_MS = 60;
const DELAY_SAMPLES = 5;
const PENDING_PING_LIMIT = 10;

export type LiveClient = {
  readonly id: string;
  readonly userId: string;
  readonly bufferedAmount: number;
  send(text: string): void;
};

export type ProfileState = Omit<LiveState, 'seq' | 'voiceDeviceId' | 'voiceReady'>;

export type OutcomeHandler = (userId: string, cueId: string, outcome: CueOutcome, startDelayMs: number | null) => void;

type ClientEntry = { client: LiveClient; sentVersion: number; pings: Map<number, number>; delays: number[] };

type VoiceDevice = { clientId: string; deviceId: string; ready: boolean };

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

@Injectable()
export class LiveHub implements OnModuleDestroy {
  private readonly logger = new Logger(LiveHub.name);
  private readonly clients = new Map<string, ClientEntry>();
  private readonly voices = new Map<string, VoiceDevice>();
  private readonly stateTimer: NodeJS.Timeout;
  private readonly pingTimer: NodeJS.Timeout;
  private stateSource: (userId: string) => ProfileState = () => {
    throw new Error('No live state source');
  };
  private outcomeHandler: OutcomeHandler = () => undefined;
  private version = 1;
  private seq = 0;
  private nextPingId = 1;

  constructor(@Inject(MONO_CLOCK) private readonly clock: MonoClock) {
    this.stateTimer = setInterval(() => this.flush(), STATE_INTERVAL_MS);
    this.pingTimer = setInterval(() => this.pingAll(), PING_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    clearInterval(this.stateTimer);
    clearInterval(this.pingTimer);
  }

  useStateSource(source: (userId: string) => ProfileState): void {
    this.stateSource = source;
  }

  onOutcome(handler: OutcomeHandler): void {
    this.outcomeHandler = handler;
  }

  attach(client: LiveClient): void {
    const entry: ClientEntry = { client, sentVersion: 0, pings: new Map(), delays: [] };
    this.clients.set(client.id, entry);
    this.sendState(entry);
  }

  detach(client: LiveClient): void {
    this.clients.delete(client.id);
    const voice = this.voices.get(client.userId);
    if (voice?.clientId === client.id) {
      this.voices.delete(client.userId);
      this.changed();
    }
  }

  receive(client: LiveClient, message: ClientMsg): void {
    const entry = this.clients.get(client.id);
    if (!entry) return;
    if (message.type === 'pong') this.recordPong(entry, message.id, message.outputLatencyMs);
    else if (message.type === 'claim-voice') this.claimVoice(entry, message.deviceId, message.ready);
    else if (message.type === 'release-voice') this.releaseVoice(entry);
    else this.outcomeHandler(client.userId, message.cueId, message.outcome, message.startDelayMs);
  }

  voiceReady(userId: string): boolean {
    return this.voices.get(userId)?.ready === true;
  }

  deviceDelayMs(userId: string): number {
    const voice = this.voices.get(userId);
    const delays = voice ? this.clients.get(voice.clientId)?.delays : undefined;
    return delays && delays.length > 0 ? median(delays) : UNMEASURED_DEVICE_DELAY_MS;
  }

  sendCue(userId: string, cue: LiveCue): boolean {
    const voice = this.voices.get(userId);
    const entry = voice ? this.clients.get(voice.clientId) : undefined;
    if (!entry) return false;
    return this.deliver(entry, { type: 'cue', cue, sentMs: this.clock.now() });
  }

  cancel(userId: string, generation: number): void {
    for (const entry of this.clientsOf(userId)) this.deliver(entry, { type: 'cancel', generation });
  }

  changed(): void {
    this.version++;
  }

  flush(): void {
    for (const entry of this.clients.values()) {
      if (entry.sentVersion >= this.version || entry.client.bufferedAmount > MAX_PENDING_BYTES) continue;
      this.sendState(entry);
    }
  }

  private clientsOf(userId: string): ClientEntry[] {
    return [...this.clients.values()].filter(entry => entry.client.userId === userId);
  }

  private sendState(entry: ClientEntry): void {
    const userId = entry.client.userId;
    const voice = this.voices.get(userId);
    let profile: ProfileState;
    try {
      profile = this.stateSource(userId);
    } catch (error) {
      this.logger.error(`Live state failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const state: LiveState = { ...profile, seq: ++this.seq, voiceDeviceId: voice?.deviceId ?? null, voiceReady: voice?.ready === true };
    entry.sentVersion = this.version;
    this.deliver(entry, { type: 'state', state });
  }

  private deliver(entry: ClientEntry, message: ServerMsg): boolean {
    try {
      entry.client.send(JSON.stringify(message));
      return true;
    } catch (error) {
      this.logger.warn(`Live message not sent: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private claimVoice(entry: ClientEntry, deviceId: string, ready: boolean): void {
    this.voices.set(entry.client.userId, { clientId: entry.client.id, deviceId, ready });
    this.changed();
    this.ping(entry);
  }

  private releaseVoice(entry: ClientEntry): void {
    const voice = this.voices.get(entry.client.userId);
    if (voice?.clientId !== entry.client.id) return;
    this.voices.delete(entry.client.userId);
    this.changed();
  }

  private pingAll(): void {
    for (const entry of this.clients.values()) this.ping(entry);
  }

  private ping(entry: ClientEntry): void {
    const id = this.nextPingId++;
    const serverMs = this.clock.now();
    entry.pings.set(id, serverMs);
    if (entry.pings.size > PENDING_PING_LIMIT) entry.pings.delete(entry.pings.keys().next().value!);
    this.deliver(entry, { type: 'ping', id, serverMs });
  }

  private recordPong(entry: ClientEntry, id: number, outputLatencyMs: number): void {
    const sentAt = entry.pings.get(id);
    if (sentAt === undefined) return;
    entry.pings.delete(id);
    const roundTripMs = this.clock.now() - sentAt;
    entry.delays.push(roundTripMs / 2 + outputLatencyMs);
    if (entry.delays.length > DELAY_SAMPLES) entry.delays.shift();
  }
}
