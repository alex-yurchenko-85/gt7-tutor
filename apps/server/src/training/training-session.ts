import type { LiveGuidance, Sample, TrainingMode } from '@gt7/contracts';
import {
  AttemptTracker,
  Coach,
  KPH_PER_MPS,
  Matcher,
  SequenceTracker,
  cueText,
  type AttemptEvent,
  type CoreConfig,
  type Cue,
  type ManualAction,
  type Match,
  type ReferenceCueEvent,
  type ReferencePath
} from '@gt7/core';

export type TrainingSnapshot = {
  userId: string;
  exerciseId: string;
  referenceId: string;
  mode: TrainingMode;
  path: ReferencePath;
  events: ReferenceCueEvent[];
  mutedKeys: ReadonlySet<string>;
  speakTargets: boolean;
  offsetsMs: ReadonlyMap<string, number>;
  sideCueDistanceM: number | null;
};

export type CueRecord = {
  cueId: string | null;
  eventKey: string;
  kind: string;
  targetKph: number | null;
  decidedMonoMs: number;
  outcome: string;
  startDelayMs: number | null;
  deviceDelayMs: number | null;
};

export type AttemptRecord = {
  generation: number;
  completion: 'complete' | 'aborted';
  reason: string | null;
  firstRawIndex: number;
  lastRawIndex: number;
  startedAt: Date;
  samples: Sample[];
  cues: CueRecord[];
};

export type TrainingEffects = {
  deviceDelayMs(): number;
  phraseMs(clip: string): number;
  nextGeneration(): number;
  sendCue(cue: Cue): boolean;
  cancel(generation: number): void;
  attemptEnded(record: AttemptRecord): void;
  changed(): void;
};

export type SessionMode = 'armed' | 'driving' | 'paused' | 'finished';

export type SessionView = {
  mode: SessionMode;
  generation: number;
  attemptNumber: number | null;
  guidance: LiveGuidance;
  sM: number | null;
  speedKph: number | null;
  lastCue: Cue | null;
  nextCue: { text: string; inM: number } | null;
};

type OpenAttempt = { generation: number; startedAt: Date; samples: Sample[]; cues: CueRecord[] };

const ACTIVE_GUIDANCE: LiveGuidance = { mode: 'active', reason: null };

function speakable(event: ReferenceCueEvent): string {
  return cueText(event.voice);
}

export class TrainingSession {
  readonly snapshot: TrainingSnapshot;
  private readonly effects: TrainingEffects;
  private readonly tracker: AttemptTracker;
  private readonly matcher: Matcher;
  private readonly coach: Coach;
  private readonly sequence = new SequenceTracker();
  private readonly eventKinds: Map<string, string>;
  private readonly cuesById = new Map<string, CueRecord>();
  private previous: Sample | null = null;
  private attempt: OpenAttempt | null = null;
  private attempts = 0;
  private view: SessionView = {
    mode: 'armed',
    generation: 0,
    attemptNumber: null,
    guidance: ACTIVE_GUIDANCE,
    sM: null,
    speedKph: null,
    lastCue: null,
    nextCue: null
  };

  constructor(snapshot: TrainingSnapshot, config: CoreConfig, effects: TrainingEffects) {
    this.snapshot = snapshot;
    this.effects = effects;
    const path = snapshot.path;
    this.tracker = new AttemptTracker({ start: path.start, end: path.end, startKind: path.startKind }, config);
    this.matcher = new Matcher(path, config);
    this.coach = new Coach(path, snapshot.events, config);
    this.eventKinds = new Map(snapshot.events.map(event => [event.key, event.kind]));
  }

  get state(): SessionView {
    return this.view;
  }

  get attemptActive(): boolean {
    return this.attempt !== null;
  }

  onSample(sample: Sample): void {
    if (this.sequence.accept(sample).duplicate) return;
    this.attempt?.samples.push(sample);
    this.handle(this.tracker.step(sample), sample);
    if (this.attempt && (this.tracker.state === 'driving' || this.tracker.state === 'paused')) this.guide(sample);
    else this.view = { ...this.view, sM: null, speedKph: sample.speedMps * KPH_PER_MPS, nextCue: null };
    this.previous = sample;
    this.effects.changed();
  }

  tick(nowMonoMs: number): void {
    const events = this.tracker.tick(nowMonoMs);
    if (events.length === 0) return;
    this.handle(events, null);
    this.effects.changed();
  }

  manual(action: ManualAction, nowMonoMs: number): void {
    this.handle(this.tracker.manual(action, nowMonoMs), null);
    this.effects.changed();
  }

  recordOutcome(cueId: string, outcome: string, startDelayMs: number | null): CueRecord | null {
    const record = this.cuesById.get(cueId);
    if (!record) return null;
    record.outcome = outcome;
    record.startDelayMs = startDelayMs;
    return record;
  }

  private handle(events: AttemptEvent[], sample: Sample | null): void {
    for (const event of events) {
      if (event.type === 'started') this.start(event, sample);
      else if (event.type === 'paused') this.pause();
      else if (event.type === 'resumed') this.view = { ...this.view, mode: 'driving' };
      else this.end(event);
    }
  }

  private start(event: AttemptEvent, sample: Sample | null): void {
    if (this.view.generation > 0) this.effects.cancel(this.view.generation);
    const generation = this.effects.nextGeneration();
    this.matcher.reset();
    this.coach.reset(generation);
    const samples = event.reason === 'manual' ? [] : [this.previous, sample].filter((item): item is Sample => item !== null);
    this.attempt = { generation, startedAt: new Date(), samples, cues: [] };
    this.attempts++;
    this.view = { ...this.view, mode: 'driving', generation, attemptNumber: this.attempts, guidance: ACTIVE_GUIDANCE, lastCue: null };
  }

  private pause(): void {
    this.effects.cancel(this.view.generation);
    this.view = { ...this.view, mode: 'paused' };
  }

  private end(event: AttemptEvent): void {
    this.effects.cancel(this.view.generation);
    const attempt = this.attempt;
    this.attempt = null;
    this.view = { ...this.view, mode: 'finished', sM: null, nextCue: null };
    if (!attempt) return;
    const first = attempt.samples[0]?.rawIndex ?? event.rawIndex;
    const last = event.rawIndex ?? attempt.samples.at(-1)?.rawIndex ?? first;
    if (first === null || first === undefined || last === null) return;
    this.effects.attemptEnded({
      generation: attempt.generation,
      completion: event.type === 'finished' ? 'complete' : 'aborted',
      reason: event.reason,
      firstRawIndex: first,
      lastRawIndex: Math.max(first, last),
      startedAt: attempt.startedAt,
      samples: attempt.samples.filter(item => item.rawIndex <= last),
      cues: attempt.cues
    });
  }

  private guide(sample: Sample): void {
    const match = this.matcher.step(sample);
    this.view = { ...this.view, sM: match?.sM ?? null, speedKph: sample.speedMps * KPH_PER_MPS, nextCue: this.nextCue(match) };
    if (this.snapshot.mode !== 'guided') return;
    const output = this.coach.step({
      sample,
      match,
      nowMonoMs: sample.receivedMonoMs,
      generation: this.view.generation,
      deviceDelayMs: this.effects.deviceDelayMs(),
      phraseMs: clip => this.effects.phraseMs(clip),
      mutedKeys: this.snapshot.mutedKeys,
      speakTargets: this.snapshot.speakTargets,
      offsetsMs: this.snapshot.offsetsMs,
      sideCueDistanceM: this.snapshot.sideCueDistanceM
    });
    this.view = { ...this.view, guidance: output.guidance };
    for (const entry of output.suppressed) {
      this.attempt?.cues.push({
        cueId: null,
        eventKey: entry.eventKey,
        kind: this.eventKinds.get(entry.eventKey) ?? entry.eventKey.split('@')[0]!,
        targetKph: null,
        decidedMonoMs: sample.receivedMonoMs,
        outcome: `suppressed-${entry.why}`,
        startDelayMs: null,
        deviceDelayMs: null
      });
    }
    if (output.cue) this.voice(output.cue);
  }

  private voice(cue: Cue): void {
    const record: CueRecord = {
      cueId: cue.id,
      eventKey: cue.eventKey,
      kind: cue.kind,
      targetKph: cue.targetSpeedKph,
      decidedMonoMs: cue.decidedMonoMs,
      outcome: 'pending',
      startDelayMs: null,
      deviceDelayMs: this.effects.deviceDelayMs()
    };
    this.attempt?.cues.push(record);
    this.cuesById.set(cue.id, record);
    record.outcome = this.effects.sendCue(cue) ? 'sent' : 'no-device';
    this.view = { ...this.view, lastCue: cue };
  }

  private nextCue(match: Match | null): { text: string; inM: number } | null {
    if (!match) return null;
    for (const event of this.snapshot.events) {
      if (event.sM <= match.sM || this.snapshot.mutedKeys.has(event.key)) continue;
      const text = speakable(event);
      if (text) return { text, inM: event.sM - match.sM };
    }
    return null;
  }
}
