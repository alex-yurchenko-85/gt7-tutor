import type { LiveGuidance, Sample } from '@gt7/contracts';
import { AttemptTracker, type AttemptEvent } from './attempts.ts';
import { Coach, type CoachSettings, type CueTarget, type Suppressed } from './coach.ts';
import type { CoreConfig } from './config.ts';
import type { Cue } from './cue-factory.ts';
import type { ReferenceCueEvent } from './cue-events.ts';
import { cueText } from './cue-text.ts';
import { ACTIVE_GUIDANCE } from './guidance.ts';
import { Matcher, type Match } from './match.ts';
import type { ReferenceAnalysis } from './reference-analysis.ts';
import { StepCursor, type Step } from './step-cursor.ts';
import { gapToReferenceMs } from './timing.ts';

export type RunNow = { deviceDelayMs: number; phraseMs: (clip: string) => number };

export type NextCue = { text: string; inM: number };

export type TrainingRunOptions = { guided: boolean; nextGeneration: () => number };

export type RunStep = {
  attemptEvents: AttemptEvent[];
  match: Match | null;
  gapMs: number | null;
  nextCue: NextCue | null;
  cue: Cue | null;
  target: CueTarget | null;
  suppressed: Suppressed[];
  guidance: LiveGuidance;
  startSamples: Sample[];
};

type Upcoming = { event: ReferenceCueEvent; text: string };

function nextCueCursor(events: ReferenceCueEvent[], mutedKeys: ReadonlySet<string>): StepCursor<Upcoming | null> {
  const ahead: Upcoming[] = [];
  for (const event of events) {
    if (mutedKeys.has(event.key)) continue;
    const text = cueText(event.voice);
    const last = ahead.at(-1);
    if (text && (!last || event.sM > last.event.sM)) ahead.push({ event, text });
  }
  const steps: Step<Upcoming | null>[] = ahead.map((upcoming, index) => ({ fromM: upcoming.event.sM, value: ahead[index + 1] ?? null }));
  return new StepCursor(ahead[0] ?? null, steps);
}

export class TrainingRun {
  private readonly nextCues: StepCursor<Upcoming | null>;
  private readonly options: TrainingRunOptions;
  private readonly tracker: AttemptTracker;
  private readonly matcher: Matcher;
  private readonly coach: Coach;
  private current = 0;
  private previous: Sample | null = null;
  private guidance: LiveGuidance = ACTIVE_GUIDANCE;

  constructor(analysis: ReferenceAnalysis, config: CoreConfig, settings: CoachSettings, options: TrainingRunOptions) {
    this.nextCues = nextCueCursor(analysis.events, settings.mutedKeys);
    this.options = options;
    this.tracker = new AttemptTracker(config);
    this.matcher = new Matcher(analysis.path, config);
    this.coach = new Coach(analysis, config, settings);
  }

  get state(): AttemptTracker['state'] {
    return this.tracker.state;
  }

  get generation(): number {
    return this.current;
  }

  step(sample: Sample, now: RunNow): RunStep {
    const attemptEvents = this.tracker.step(sample);
    const startSamples = attemptEvents.some(event => event.type === 'started') ? this.start(sample) : [];
    this.previous = sample;
    const idle: RunStep = { attemptEvents, match: null, gapMs: null, nextCue: null, cue: null, target: null, suppressed: [], guidance: this.guidance, startSamples };
    if (this.state !== 'driving' && this.state !== 'paused') return idle;
    const match = this.matcher.step(sample);
    const gapMs = match && sample.gameTimerMs > 0 ? gapToReferenceMs(match, sample.gameTimerMs) : null;
    const located = { ...idle, match, gapMs, nextCue: this.nextCue(match) };
    if (!this.options.guided) return located;
    const output = this.coach.step({ sample, match, nowMonoMs: sample.receivedMonoMs, generation: this.current, ...now });
    this.guidance = output.guidance;
    return { ...located, cue: output.cue, target: output.target, suppressed: output.suppressed, guidance: output.guidance };
  }

  tick(nowMonoMs: number): AttemptEvent[] {
    return this.tracker.tick(nowMonoMs);
  }

  abortByUser(nowMonoMs: number): AttemptEvent[] {
    return this.tracker.abortByUser(nowMonoMs);
  }

  private start(sample: Sample): Sample[] {
    this.current = this.options.nextGeneration();
    this.matcher.reset();
    this.guidance = ACTIVE_GUIDANCE;
    return [this.previous, sample].filter((item): item is Sample => item !== null);
  }

  private nextCue(match: Match | null): NextCue | null {
    if (!match) return null;
    const next = this.nextCues.at(match.sM);
    return next ? { text: next.text, inM: next.event.sM - match.sM } : null;
  }
}
