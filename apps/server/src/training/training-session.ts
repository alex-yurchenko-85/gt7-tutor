import { KPH_PER_MPS, type CueEventKind, type CueOutcome, type LiveCueKind, type LiveGuidance, type Sample, type TrainingMode } from '@gt7/contracts';
import {
  ACTIVE_GUIDANCE,
  TrainingRun,
  type AttemptEvent,
  type CoachSettings,
  type CoreConfig,
  type SuppressReason,
  type Cue,
  type CueTarget,
  type NextCue,
  type ReferenceAnalysis,
  type RunStep
} from '@gt7/core';

export type TrainingSnapshot = CoachSettings & {
  userId: string;
  exerciseId: string;
  referenceId: string;
  mode: TrainingMode;
  analysis: ReferenceAnalysis;
};

export type CueRecordOutcome =
  | CueOutcome
  | 'pending'
  | 'sent'
  | 'no-device'
  | 'suppressed-during-attempt'
  | `suppressed-${SuppressReason}`;

export type CueRecord = {
  cueId: string | null;
  eventKey: string;
  kind: LiveCueKind | CueEventKind;
  eventKind: CueEventKind;
  sM: number | null;
  targetKph: number | null;
  decidedMonoMs: number;
  outcome: CueRecordOutcome;
  startDelayMs: number | null;
  deviceDelayMs: number | null;
};

export type AttemptRecord = {
  generation: number;
  completion: 'complete' | 'aborted';
  reason: string | null;
  firstRawIndex: number;
  lastRawIndex: number;
  gameTimeMs: number | null;
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
  speedMps: number | null;
  lastCue: Cue | null;
  nextCue: NextCue | null;
  gapMs: number | null;
};

const GAP_STEP_MS = 100;

function shownKey(view: SessionView): string {
  const { guidance, nextCue } = view;
  const speed = view.speedMps === null ? '' : Math.round(view.speedMps * KPH_PER_MPS);
  const place = view.sM === null ? '' : Math.round(view.sM);
  const gap = view.gapMs === null ? '' : Math.round(view.gapMs / GAP_STEP_MS) || 0;
  const next = nextCue === null ? '' : `${nextCue.text}@${Math.round(nextCue.inM)}`;
  return [view.mode, view.generation, view.attemptNumber, guidance.mode, guidance.reason, speed, place, gap, next, view.lastCue?.id].join('|');
}

type OpenAttempt = { generation: number; startedAt: Date; samples: Sample[]; cues: CueRecord[] };

export class TrainingSession {
  readonly snapshot: TrainingSnapshot;
  private readonly effects: TrainingEffects;
  private readonly run: TrainingRun;
  private cuesById = new Map<string, CueRecord>();
  private previousCuesById = new Map<string, CueRecord>();
  private shown = '';
  private readonly phraseMs = (clip: string): number => this.effects.phraseMs(clip);
  private attempt: OpenAttempt | null = null;
  private attempts = 0;
  private view: SessionView = {
    mode: 'armed',
    generation: 0,
    attemptNumber: null,
    guidance: ACTIVE_GUIDANCE,
    sM: null,
    speedMps: null,
    lastCue: null,
    nextCue: null,
    gapMs: null
  };

  constructor(snapshot: TrainingSnapshot, config: CoreConfig, effects: TrainingEffects) {
    this.snapshot = snapshot;
    this.effects = effects;
    this.run = new TrainingRun(snapshot.analysis, config, snapshot, {
      guided: snapshot.mode === 'guided',
      nextGeneration: () => effects.nextGeneration()
    });
  }

  get state(): SessionView {
    return this.view;
  }

  get attemptActive(): boolean {
    return this.attempt !== null;
  }

  onSample(sample: Sample): void {
    this.attempt?.samples.push(sample);
    const deviceDelayMs = this.effects.deviceDelayMs();
    const step = this.run.step(sample, { deviceDelayMs, phraseMs: this.phraseMs });
    this.handle(step.attemptEvents, step.startSamples);
    this.view = { ...this.view, sM: step.match?.sM ?? null, speedMps: sample.speedMps, nextCue: step.nextCue, gapMs: step.gapMs, guidance: step.guidance };
    this.recordCues(step, sample, deviceDelayMs);
    this.notify();
  }

  tick(nowMonoMs: number): void {
    const events = this.run.tick(nowMonoMs);
    if (events.length === 0) return;
    this.handle(events, []);
    this.notify();
  }

  abortByUser(nowMonoMs: number): void {
    this.handle(this.run.abortByUser(nowMonoMs), []);
    this.notify();
  }

  recordOutcome(cueId: string, outcome: CueOutcome, startDelayMs: number | null): CueRecord | null {
    const record = this.cuesById.get(cueId) ?? this.previousCuesById.get(cueId);
    if (!record) return null;
    record.outcome = outcome;
    record.startDelayMs = startDelayMs;
    return record;
  }

  private notify(): void {
    const key = shownKey(this.view);
    if (key === this.shown) return;
    this.shown = key;
    this.effects.changed();
  }

  private handle(events: AttemptEvent[], startSamples: Sample[]): void {
    for (const event of events) {
      if (event.type === 'started') this.start(startSamples);
      else if (event.type === 'paused') this.pause();
      else if (event.type === 'resumed') this.view = { ...this.view, mode: 'driving' };
      else this.end(event);
    }
  }

  private start(samples: Sample[]): void {
    if (this.view.generation > 0) this.effects.cancel(this.view.generation);
    const { generation } = this.run;
    this.previousCuesById = this.cuesById;
    this.cuesById = new Map();
    this.attempt = { generation, startedAt: new Date(), samples, cues: [] };
    this.attempts++;
    this.view = { ...this.view, mode: 'driving', generation, attemptNumber: this.attempts, lastCue: null };
  }

  private pause(): void {
    this.effects.cancel(this.view.generation);
    this.view = { ...this.view, mode: 'paused' };
  }

  private end(event: AttemptEvent): void {
    this.effects.cancel(this.view.generation);
    const attempt = this.attempt;
    this.attempt = null;
    this.view = { ...this.view, mode: 'finished', sM: null, nextCue: null, gapMs: null };
    if (!attempt) return;
    const first = attempt.samples[0]?.rawIndex ?? event.rawIndex;
    const lastSeen = attempt.samples.at(-1)?.rawIndex;
    const last = (event.type === 'finished' ? lastSeen ?? event.rawIndex : event.rawIndex ?? lastSeen) ?? first;
    if (first === null || first === undefined || last === null) return;
    this.effects.attemptEnded({
      generation: attempt.generation,
      completion: event.type === 'finished' ? 'complete' : 'aborted',
      reason: event.reason,
      firstRawIndex: first,
      lastRawIndex: Math.max(first, last),
      gameTimeMs: event.gameTimeMs,
      startedAt: attempt.startedAt,
      samples: attempt.samples.filter(item => item.rawIndex <= last),
      cues: attempt.cues
    });
  }

  private recordCues(step: RunStep, sample: Sample, deviceDelayMs: number): void {
    for (const entry of step.suppressed) {
      this.attempt?.cues.push({
        cueId: null,
        eventKey: entry.eventKey,
        kind: entry.target.eventKind,
        eventKind: entry.target.eventKind,
        sM: entry.target.sM,
        targetKph: null,
        decidedMonoMs: sample.receivedMonoMs,
        outcome: `suppressed-${entry.why}`,
        startDelayMs: null,
        deviceDelayMs: null
      });
    }
    if (step.cue && step.target) this.voice(step.cue, step.target, deviceDelayMs);
  }

  private voice(cue: Cue, target: CueTarget, deviceDelayMs: number): void {
    const record: CueRecord = {
      cueId: cue.id,
      eventKey: cue.eventKey,
      kind: cue.kind,
      eventKind: target.eventKind,
      sM: target.sM,
      targetKph: cue.targetSpeedKph,
      decidedMonoMs: cue.decidedMonoMs,
      outcome: 'pending',
      startDelayMs: null,
      deviceDelayMs
    };
    this.attempt?.cues.push(record);
    this.cuesById.set(cue.id, record);
    record.outcome = this.effects.sendCue(cue) ? 'sent' : 'no-device';
    this.view = { ...this.view, lastCue: cue };
  }
}
