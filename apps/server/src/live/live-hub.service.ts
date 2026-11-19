import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { DEFAULT_STATE_RATE, median, type ClientMsg, type CueOutcome, type LiveCue, type LiveState, type ServerMsg, type StateRate } from '@gt7/contracts';
import type { Knex } from 'knex';
import { dropOldest } from '../drop-oldest.js';
import { MONO_CLOCK, type MonoClock } from '../clock/mono-clock.js';
import { KNEX } from '../storage/knex.provider.js';

export const STATE_TICKS_PER_SECOND = 60;
export const STATE_TICK_MS = 1000 / STATE_TICKS_PER_SECOND;
export const PING_INTERVAL_MS = 1000;
export const MAX_PENDING_BYTES = 256 * 1024;
export const UNMEASURED_DEVICE_DELAY_MS = 60;
const DELAY_SAMPLES = 5;
const PENDING_PING_LIMIT = 10;

export type LiveClient = {
  readonly id: string;
  readonly userId: string;
  readonly sessionKey: string;
  readonly bufferedAmount: number;
  send(text: string): void;
  close(reason: string): void;
};

export const SESSION_ENDED = 'Session ended';

export type ProfileState = Omit<LiveState, 'seq' | 'voiceDeviceId' | 'voiceReady'>;

export type OutcomeHandler = (userId: string, cueId: string, outcome: CueOutcome, startDelayMs: number | null) => void;

type ClientEntry = {
  client: LiveClient;
  sentVersion: number;
  ticksPerState: number;
  ticksSinceState: number;
  pings: Map<number, number>;
  delays: number[];
};

function ticksPerState(rate: StateRate): number {
  return STATE_TICKS_PER_SECOND / rate;
}

type VoiceDevice = { clientId: string; deviceId: string; ready: boolean };

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
  private generation = Date.now();

  constructor(
    @Inject(MONO_CLOCK) private readonly clock: MonoClock,
    @Inject(KNEX) private readonly db: Knex
  ) {
    this.stateTimer = setInterval(() => this.flush(), STATE_TICK_MS);
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
    const entry: ClientEntry = {
      client,
      sentVersion: 0,
      ticksPerState: ticksPerState(DEFAULT_STATE_RATE),
      ticksSinceState: 0,
      pings: new Map(),
      delays: []
    };
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
    else if (message.type === 'state-rate') entry.ticksPerState = ticksPerState(message.perSecond);
    else this.outcomeHandler(client.userId, message.cueId, message.outcome, message.startDelayMs);
  }

  closeOtherSessions(userId: string, keptSessionKey: string): void {
    for (const entry of this.clientsOf(userId)) if (entry.client.sessionKey !== keptSessionKey) this.closeClient(entry, SESSION_ENDED);
  }

  voiceReady(userId: string): boolean {
    return this.voices.get(userId)?.ready === true;
  }

  deviceDelayMs(userId: string): number {
    const voice = this.voices.get(userId);
    const delays = voice ? this.clients.get(voice.clientId)?.delays : undefined;
    return median(delays ?? []) ?? UNMEASURED_DEVICE_DELAY_MS;
  }

  sendCue(userId: string, cue: LiveCue): boolean {
    const voice = this.voices.get(userId);
    const entry = voice ? this.clients.get(voice.clientId) : undefined;
    if (!entry) return false;
    return this.deliver(entry, { type: 'cue', cue, sentMs: this.clock.now() });
  }

  nextGeneration(): number {
    return ++this.generation;
  }

  cancel(userId: string, generation: number): void {
    for (const entry of this.clientsOf(userId)) this.deliver(entry, { type: 'cancel', generation });
  }

  changed(): void {
    this.version++;
  }

  flush(): void {
    for (const entry of this.clients.values()) {
      entry.ticksSinceState++;
      if (entry.ticksSinceState < entry.ticksPerState) continue;
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
    entry.ticksSinceState = 0;
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

  private closeClient(entry: ClientEntry, reason: string): void {
    entry.client.close(reason);
    this.detach(entry.client);
  }

  private pingAll(): void {
    for (const entry of this.clients.values()) this.ping(entry);
    void this.closeEndedSessions();
  }

  private async closeEndedSessions(): Promise<void> {
    const entries = [...this.clients.values()];
    if (entries.length === 0) return;
    const keys = [...new Set(entries.map(entry => entry.client.sessionKey))];
    let rows: { token_hash: string }[];
    try {
      rows = await this.db('sessions').whereRaw('token_hash = any(?)', [keys]).where('expires_at', '>', this.db.fn.now()).select('token_hash');
    } catch (error) {
      this.logger.warn(`Session check failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const live = new Set(rows.map(row => row.token_hash));
    for (const entry of entries) if (!live.has(entry.client.sessionKey) && this.clients.get(entry.client.id) === entry) this.closeClient(entry, SESSION_ENDED);
  }

  private ping(entry: ClientEntry): void {
    const id = this.nextPingId++;
    const serverMs = this.clock.now();
    entry.pings.set(id, serverMs);
    dropOldest(entry.pings, PENDING_PING_LIMIT);
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
