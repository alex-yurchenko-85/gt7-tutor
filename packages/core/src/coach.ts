import { eventKey, type CueEventKind, type LiveCueKind, type LiveGuidance, type Sample } from '@gt7/contracts';
import { hasPlayerControl } from './attempts.ts';
import type { CoreConfig } from './config.ts';
import type { ReferenceCueEvent } from './cue-events.ts';
import { cuePriority, makeCue, type Cue } from './cue-factory.ts';
import { cornerCursor, outsideM, type Corner } from './corners.ts';
import { clipKey, targetClip } from './cue-text.ts';
import { Guidance, type GuidanceTransition } from './guidance.ts';
import type { Match } from './match.ts';
import type { ReferenceAnalysis } from './reference-analysis.ts';
import { pointAt, type ReferencePath } from './reference.ts';
import { SpeedWindow } from './speed-window.ts';
import type { StepCursor } from './step-cursor.ts';

export type SuppressReason =
  | 'muted'
  | 'cooldown'
  | 'lower-priority'
  | 'too-late'
  | 'missed'
  | 'suspended'
  | 'already-full'
  | 'unstable'
  | 'brake-in-horizon'
  | 'acceleration-unsafe'
  | 'target-incompatible';

export type CueTarget = { eventKind: CueEventKind; voice: string; sM: number | null; muteKey: string | null };

export type Suppressed = { eventKey: string; why: SuppressReason; target: CueTarget };

export type CoachSettings = {
  mutedKeys: ReadonlySet<string>;
  speakTargets: boolean;
  offsetsMs: ReadonlyMap<string, number>;
  sideCueDistanceM: number | null;
};

export type CoachInput = {
  sample: Sample;
  match: Match | null;
  nowMonoMs: number;
  generation: number;
  deviceDelayMs: number;
  phraseMs: (clip: string) => number;
};

export type CoachOutput = { cue: Cue | null; target: CueTarget | null; guidance: LiveGuidance; suppressed: Suppressed[] };

type Speech = {
  eventKey: string;
  target: CueTarget;
  kind: LiveCueKind;
  targetSpeedKph: number | null;
  clip: string;
  followClip: string | null;
};

type Candidate = Speech & { priority: number; gate: SuppressReason | null; held: SuppressReason | null; opens: ReferenceCueEvent | null };

type Spoken = { cue: Cue; target: CueTarget };

type ThrottleWindow = { event: ReferenceCueEvent; lastWhy: SuppressReason };

type Due = { event: ReferenceCueEvent; timeMs: number };

type WideEpisode = { corner: number; sinceMs: number };

type SideEpisode = { side: 'left' | 'right'; sinceMs: number; decided: boolean };

type Step = { input: CoachInput; match: Match; periodMs: number; accelerationMps2: number; suppressed: Suppressed[] };

const TIGHTER_MUTE_KEY = 'tighter';

export function bigStopKey(brake: ReferenceCueEvent): string {
  return eventKey('big-stop', brake.sM);
}

function eventTarget(event: ReferenceCueEvent): CueTarget {
  return { eventKind: event.kind, voice: event.voice, sM: event.sM, muteKey: event.key };
}

function bigStopTarget(brake: ReferenceCueEvent): CueTarget {
  return { eventKind: 'big-stop', voice: 'big-stop', sM: brake.sM, muteKey: brake.key };
}

function candidateOf(config: CoreConfig, speech: Speech, gate: SuppressReason | null = null, held: SuppressReason | null = null, opens: ReferenceCueEvent | null = null): Candidate {
  return { ...speech, priority: cuePriority(speech.kind, config), gate, held, opens };
}

export function tighterKey(corner: Corner): string {
  return `tighter@${corner.number}`;
}

function byKey(events: ReferenceCueEvent[], keyOf: (event: ReferenceCueEvent) => string): Map<string, ReferenceCueEvent[]> {
  const grouped = new Map<string, ReferenceCueEvent[]>();
  for (const event of events) {
    const key = keyOf(event);
    const group = grouped.get(key);
    if (group) group.push(event);
    else grouped.set(key, [event]);
  }
  return grouped;
}

function timeToReachMs(distanceM: number, speedMps: number, accelerationMps2: number): number {
  if (distanceM <= 0) return 0;
  if (accelerationMps2 > 1e-6) {
    const seconds = (-speedMps + Math.sqrt(speedMps * speedMps + 2 * accelerationMps2 * distanceM)) / accelerationMps2;
    return seconds * 1000;
  }
  return speedMps > 0 ? (distanceM / speedMps) * 1000 : Number.POSITIVE_INFINITY;
}

export class Coach {
  private readonly path: ReferencePath;
  private readonly events: ReferenceCueEvent[];
  private readonly bigStops: ReferenceCueEvent[];
  private readonly eventsByKey: Map<string, ReferenceCueEvent[]>;
  private readonly bigStopsByKey: Map<string, ReferenceCueEvent[]>;
  private readonly config: CoreConfig;
  private readonly settings: CoachSettings;
  private readonly corners: StepCursor<Corner | null>;
  private readonly speeds: SpeedWindow;
  private readonly guidance = new Guidance();
  private generation = 0;
  private passed = 0;
  private settled = new Set<ReferenceCueEvent>();
  private settledBigStops = new Set<ReferenceCueEvent>();
  private spokenCorners = new Set<number>();
  private wideEpisode: WideEpisode | null = null;
  private openWindows = new Map<string, ThrottleWindow>();
  private checkedZones = new Set<string>();
  private blockedUntilSM: number | null = null;
  private lastCue: { priority: number; decidedMonoMs: number } | null = null;
  private stableSinceMs: number | null = null;
  private sideEpisode: SideEpisode | null = null;
  private previousNowMs: number | null = null;
  private transitions = 0;
  private suspendedSinceMs: number | null = null;
  private pauseAnnounced = false;

  constructor(analysis: ReferenceAnalysis, config: CoreConfig, settings: CoachSettings) {
    this.path = analysis.path;
    this.events = [...analysis.events].sort((a, b) => a.sM - b.sM);
    this.bigStops = this.events.filter(event => event.bigStop);
    this.eventsByKey = byKey(this.events, event => event.key);
    this.bigStopsByKey = byKey(this.bigStops, bigStopKey);
    this.config = config;
    this.settings = settings;
    this.corners = cornerCursor(analysis.corners);
    this.speeds = new SpeedWindow(config.coach.accelerationWindowMs);
    this.reset(0);
  }

  private reset(generation: number): void {
    this.generation = generation;
    this.passed = 0;
    this.settled = new Set();
    this.settledBigStops = new Set();
    this.spokenCorners = new Set();
    this.wideEpisode = null;
    this.openWindows = new Map();
    this.checkedZones = new Set();
    this.blockedUntilSM = null;
    this.lastCue = null;
    this.stableSinceMs = null;
    this.sideEpisode = null;
    this.speeds.clear();
    this.previousNowMs = null;
    this.transitions = 0;
    this.suspendedSinceMs = null;
    this.pauseAnnounced = false;
    this.guidance.reset();
  }

  step(input: CoachInput): CoachOutput {
    if (input.generation !== this.generation) this.reset(input.generation);
    const periodMs = this.periodMs(input.nowMonoMs);
    const suppressed: Suppressed[] = [];
    const { sample, match } = input;
    if (!hasPlayerControl(sample) || this.isStale(input) || this.guidance.state.mode === 'waiting-for-restart') {
      return this.output(null, suppressed);
    }
    if (!match || !match.trusted) return this.output(this.untrusted(input), suppressed);
    this.stableSinceMs ??= input.nowMonoMs;
    const step: Step = { input, match, periodMs, accelerationMps2: this.acceleration(input), suppressed };
    this.passEvents(step);
    if (match.sM >= this.path.lengthM - this.config.match.sectionEndToleranceM) {
      this.guidance.awaitRestart();
      return this.output(null, suppressed);
    }
    const paused = this.checkBrakeZones(step) ? this.guidance.suspend('target-incompatible') : null;
    if (this.guidance.state.mode === 'suspended') return this.output(this.whileSuspended(step, paused), suppressed);
    return this.output(this.decide(step), suppressed);
  }

  private output(spoken: Spoken | null, suppressed: Suppressed[]): CoachOutput {
    if (spoken) this.lastCue = { priority: spoken.cue.priority, decidedMonoMs: spoken.cue.decidedMonoMs };
    return { cue: spoken?.cue ?? null, target: spoken?.target ?? null, guidance: this.guidance.state, suppressed };
  }

  private periodMs(nowMonoMs: number): number {
    const previous = this.previousNowMs;
    this.previousNowMs = nowMonoMs;
    if (previous === null) return this.config.coach.defaultPeriodMs;
    return Math.min(this.config.coach.maxPeriodMs, Math.max(0, nowMonoMs - previous));
  }

  private isStale(input: CoachInput): boolean {
    return input.nowMonoMs - input.sample.receivedMonoMs > this.config.freshnessMs;
  }

  private untrusted(input: CoachInput): Spoken | null {
    this.stableSinceMs = null;
    this.sideEpisode = null;
    this.wideEpisode = null;
    this.speeds.clear();
    this.guidance.suspend('untrusted-position');
    return this.announcePause(input);
  }

  private announcePause(input: CoachInput, step?: Step): Spoken | null {
    if (this.guidance.state.mode !== 'suspended' || this.pauseAnnounced) return null;
    this.suspendedSinceMs ??= input.nowMonoMs;
    if (input.nowMonoMs - this.suspendedSinceMs < this.config.guidanceAnnounceAfterMs) return null;
    const cue = this.systemCue('guidance-paused', input, step);
    if (cue) this.pauseAnnounced = true;
    return cue;
  }

  private announceResume(input: CoachInput, step: Step): Spoken | null {
    const announced = this.pauseAnnounced;
    this.suspendedSinceMs = null;
    this.pauseAnnounced = false;
    return announced ? this.systemCue('guidance-resumed', input, step) : null;
  }

  private acceleration(input: CoachInput): number {
    const now = input.nowMonoMs;
    this.speeds.add(now, input.sample.speedMps);
    const spanMs = now - this.speeds.oldestAtMs;
    if (spanMs < this.config.coach.minAccelerationSpanMs) return 0;
    return Math.max(0, ((input.sample.speedMps - this.speeds.oldestSpeedMps) * 1000) / spanMs);
  }

  private pending(): ReferenceCueEvent[] {
    const pending: ReferenceCueEvent[] = [];
    for (let index = this.passed; index < this.events.length; index++) {
      const event = this.events[index]!;
      if (!this.settled.has(event)) pending.push(event);
    }
    return pending;
  }

  private somePending(test: (event: ReferenceCueEvent) => boolean): boolean {
    for (let index = this.passed; index < this.events.length; index++) {
      const event = this.events[index]!;
      if (!this.settled.has(event) && test(event)) return true;
    }
    return false;
  }

  private settle(event: ReferenceCueEvent, why: SuppressReason, step: Step): void {
    this.settled.add(event);
    this.openWindows.delete(event.key);
    step.suppressed.push({ eventKey: event.key, why, target: eventTarget(event) });
  }

  private closeWindows(step: Step, isClosed: (window: ThrottleWindow) => boolean, why?: SuppressReason): void {
    for (const window of [...this.openWindows.values()]) {
      if (isClosed(window)) this.settle(window.event, why ?? window.lastWhy, step);
    }
  }

  private settleBigStop(brake: ReferenceCueEvent, why: SuppressReason, step: Step): void {
    this.settledBigStops.add(brake);
    step.suppressed.push({ eventKey: bigStopKey(brake), why, target: bigStopTarget(brake) });
  }

  private passEvents(step: Step): void {
    const why: SuppressReason = this.guidance.state.mode === 'suspended' ? 'suspended' : 'missed';
    for (const brake of this.bigStops) {
      if (!this.settledBigStops.has(brake) && (brake.sM <= step.match.sM || this.settled.has(brake))) this.settleBigStop(brake, why, step);
    }
    while (this.passed < this.events.length && this.events[this.passed]!.sM <= step.match.sM) {
      const event = this.events[this.passed]!;
      this.passed += 1;
      if (!this.settled.has(event)) this.settle(event, why, step);
    }
  }

  private checkBrakeZones(step: Step): boolean {
    let incompatible = false;
    for (const brake of this.events) {
      if (brake.kind !== 'brake' || brake.endSM === null || brake.endSM > step.match.sM || this.checkedZones.has(brake.key)) continue;
      this.checkedZones.add(brake.key);
      const overspeedMps = step.input.sample.speedMps - pointAt(this.path, brake.endSM).speedMps;
      if (overspeedMps <= this.config.incompatibleOverspeedMps) continue;
      this.cancelDependents(brake, step);
      incompatible = true;
    }
    return incompatible;
  }

  private cancelDependents(brake: ReferenceCueEvent, step: Step): void {
    const nextBrake = this.events.find(candidate => candidate.kind === 'brake' && candidate.sM > brake.sM);
    const limitM = nextBrake?.sM ?? Number.POSITIVE_INFINITY;
    const waiting = [...this.pending(), ...[...this.openWindows.values()].map(window => window.event)];
    const dependents = waiting.filter(candidate => candidate.kind !== 'brake' && candidate.sM > brake.sM && candidate.sM < limitM);
    for (const dependent of dependents) this.settle(dependent, 'target-incompatible', step);
    const lastDependentM = Math.max(brake.endSM ?? brake.sM, ...dependents.map(dependent => dependent.sM));
    this.blockedUntilSM = Math.max(this.blockedUntilSM ?? 0, lastDependentM);
  }

  private whileSuspended(step: Step, paused: GuidanceTransition): Spoken | null {
    if (!this.somePending(event => event.sM > step.match.sM) && this.openWindows.size === 0) {
      this.guidance.awaitRestart();
      return null;
    }
    const resumable = !paused && (this.blockedUntilSM === null || step.match.sM > this.blockedUntilSM);
    const resumed = this.guidance.observeResume(resumable, step.input.nowMonoMs, this.config.guidanceResumeMs);
    if (!resumed) {
      this.settleDue(step);
      return resumable ? null : this.announcePause(step.input, step);
    }
    this.blockedUntilSM = null;
    return this.decide(step) ?? this.announceResume(step.input, step);
  }

  private settleDue(step: Step): void {
    for (const due of this.dueBigStops(step)) this.settleBigStop(due.event, 'suspended', step);
    for (const due of this.dueEvents(step)) this.settle(due.event, 'suspended', step);
    this.closeWindows(step, () => true, 'suspended');
  }

  private systemCue(kind: 'guidance-paused' | 'guidance-resumed', input: CoachInput, step?: Step): Spoken | null {
    const clip = clipKey(kind);
    if (step && this.urgentCueWithin(step, input.phraseMs(clip))) return null;
    this.transitions += 1;
    const target: CueTarget = { eventKind: 'guidance', voice: kind, sM: null, muteKey: null };
    return this.cue({ eventKey: `${kind}#${this.transitions}`, target, kind, targetSpeedKph: null, clip, followClip: null }, input);
  }

  private urgentCueWithin(step: Step, windowMs: number): boolean {
    return this.somePending(event => {
      if (event.kind === 'throttle' || event.sM <= step.match.sM) return false;
      return this.timeToEventMs(event, step) <= this.leadMs(step.input, event) + windowMs;
    });
  }

  private offsetMs(event: ReferenceCueEvent): number {
    return this.settings.offsetsMs.get(event.key) ?? 0;
  }

  private leadMs(input: CoachInput, event: ReferenceCueEvent): number {
    return input.deviceDelayMs + this.config.cue.leadReactionMs + this.offsetMs(event);
  }

  private bigStopLeadMs(input: CoachInput, brake: ReferenceCueEvent): number {
    return input.deviceDelayMs + this.config.voice.bigStopLeadMs + this.offsetMs(brake);
  }

  private timeToEventMs(event: ReferenceCueEvent, step: Step): number {
    return timeToReachMs(event.sM - step.match.sM, step.input.sample.speedMps, step.accelerationMps2);
  }

  private dueEvents(step: Step): Due[] {
    const due: Due[] = [];
    for (let index = this.passed; index < this.events.length; index++) {
      const event = this.events[index]!;
      if (this.settled.has(event) || event.sM <= step.match.sM) continue;
      const timeMs = this.timeToEventMs(event, step);
      if (timeMs <= this.leadMs(step.input, event) + step.periodMs) due.push({ event, timeMs });
    }
    return due;
  }

  private dueBigStops(step: Step): Due[] {
    const due: Due[] = [];
    for (const brake of this.bigStops) {
      if (this.settledBigStops.has(brake) || brake.sM <= step.match.sM) continue;
      const timeMs = this.timeToEventMs(brake, step);
      if (timeMs <= this.bigStopLeadMs(step.input, brake) + step.periodMs) due.push({ event: brake, timeMs });
    }
    return due;
  }

  private decide(step: Step): Spoken | null {
    const candidates: Candidate[] = [];
    const due = this.dueEvents(step);
    this.closeWindows(
      step,
      window => this.timeToEventMs(window.event, step) < step.input.deviceDelayMs || due.some(entry => entry.event.sM > window.event.sM)
    );
    for (const entry of this.dueBigStops(step)) candidates.push(candidateOf(this.config, this.bigStopSpeech(entry.event), this.bigStopGate(entry, step)));
    for (const { event, timeMs } of due) {
      const gate = timeMs < step.input.deviceDelayMs ? 'too-late' : null;
      const opens = event.kind === 'throttle' && gate === null;
      const held = opens ? this.accelerationGate(event, step) : null;
      candidates.push(candidateOf(this.config, this.speechFor(event), gate, held, opens ? event : null));
    }
    for (const window of this.openWindows.values()) {
      candidates.push(candidateOf(this.config, this.speechFor(window.event), null, this.accelerationGate(window.event, step)));
    }
    const tighter = this.tighterCandidate(step);
    if (tighter) candidates.push(tighter);
    const side = this.sideCandidate(step);
    if (side) candidates.push(side);
    return this.choose(candidates, step);
  }

  private open(event: ReferenceCueEvent): void {
    this.settled.add(event);
    this.openWindows.set(event.key, { event, lastWhy: 'unstable' });
  }

  private speechFor(event: ReferenceCueEvent): Speech {
    return {
      eventKey: event.key,
      target: eventTarget(event),
      kind: event.voice,
      targetSpeedKph: event.targetSpeedKph,
      clip: clipKey(event.voice),
      followClip: this.settings.speakTargets ? targetClip(event) : null
    };
  }

  private bigStopSpeech(brake: ReferenceCueEvent): Speech {
    return { eventKey: bigStopKey(brake), target: bigStopTarget(brake), kind: 'big-stop', targetSpeedKph: null, clip: clipKey('big-stop'), followClip: null };
  }

  private bigStopGate(due: Due, step: Step): SuppressReason | null {
    const { input } = step;
    const bigStopMs = input.phraseMs(clipKey('big-stop'));
    if (due.timeMs < this.leadMs(input, due.event) + bigStopMs) return 'too-late';
    if (this.urgentBefore(due.event, step, bigStopMs)) return 'too-late';
    return this.urgentCueSpeaking(input) ? 'cooldown' : null;
  }

  private urgentBefore(brake: ReferenceCueEvent, step: Step, bigStopMs: number): boolean {
    return this.somePending(
      event =>
        event !== brake &&
        event.kind !== 'throttle' &&
        event.sM > step.match.sM &&
        event.sM < brake.sM &&
        this.timeToEventMs(event, step) <= this.leadMs(step.input, event) + bigStopMs + step.periodMs
    );
  }

  private urgentCueSpeaking(input: CoachInput): boolean {
    const last = this.lastCue;
    if (!last || last.priority < this.config.cue.priority.easeOff) return false;
    return input.nowMonoMs - last.decidedMonoMs < this.config.cue.cooldownMs;
  }

  private tighterCandidate(step: Step): Candidate | null {
    const { match, input } = step;
    const corner = this.corners.at(match.sM);
    if (!corner || !this.beforeApex(match.sM) || this.spokenCorners.has(corner.number) || outsideM(corner, match.lateralM) <= this.config.corners.wideApexM) {
      this.wideEpisode = null;
      return null;
    }
    if (this.wideEpisode?.corner !== corner.number) this.wideEpisode = { corner: corner.number, sinceMs: input.nowMonoMs };
    if (input.nowMonoMs - this.wideEpisode.sinceMs < this.config.corners.tighterHoldMs) return null;
    this.spokenCorners.add(corner.number);
    this.wideEpisode = null;
    const target: CueTarget = { eventKind: 'tighter', voice: 'tighter', sM: match.sM, muteKey: TIGHTER_MUTE_KEY };
    return candidateOf(this.config, { eventKey: tighterKey(corner), target, kind: 'tighter', targetSpeedKph: null, clip: clipKey('tighter'), followClip: null });
  }

  private accelerationGate(event: ReferenceCueEvent, step: Step): SuppressReason | null {
    const { sample } = step.input;
    const limits = this.config.acceleration;
    const horizonM = event.sM + (sample.speedMps * this.config.target.throttleLookAheadMs) / 1000;
    if (this.events.some(other => other.kind === 'brake' && other.sM > step.match.sM && other.sM <= horizonM)) return 'brake-in-horizon';
    const now = step.input.nowMonoMs;
    if (this.stableSinceMs === null || now - this.stableSinceMs < limits.stableHoldMs || step.match.velocityErrorDeg === null) {
      return 'unstable';
    }
    const overspeedMps = sample.speedMps - step.match.reference.speedMps;
    if (
      overspeedMps > limits.maxOverspeedMps ||
      Math.abs(step.match.lateralM) > limits.maxLateralM ||
      step.match.headingErrorDeg > limits.maxHeadingErrorDeg ||
      step.match.velocityErrorDeg > limits.maxHeadingErrorDeg ||
      sample.brake > limits.maxBrake
    ) {
      return 'acceleration-unsafe';
    }
    if (event.voice === 'full-throttle' && sample.throttle >= this.config.voice.fullThrottle) return 'already-full';
    return null;
  }

  private sideCandidate(step: Step): Candidate | null {
    const distanceM = this.settings.sideCueDistanceM;
    const lateralM = step.match.lateralM;
    if (distanceM === null || Math.abs(lateralM) <= distanceM) {
      this.sideEpisode = null;
      return null;
    }
    const side = lateralM > 0 ? 'right' : 'left';
    if (!this.sideEpisode || this.sideEpisode.side !== side) {
      this.sideEpisode = { side, sinceMs: step.input.nowMonoMs, decided: false };
    }
    const episode = this.sideEpisode;
    if (episode.decided || step.input.nowMonoMs - episode.sinceMs < this.config.position.holdMs) return null;
    if (this.beforeApex(step.match.sM)) return null;
    episode.decided = true;
    const kind = side === 'right' ? 'keep-left' : 'keep-right';
    const target: CueTarget = { eventKind: kind, voice: kind, sM: step.match.sM, muteKey: kind };
    return candidateOf(this.config, { eventKey: eventKey(kind, step.match.sM), target, kind, targetSpeedKph: null, clip: clipKey(kind), followClip: null });
  }

  private beforeApex(sM: number): boolean {
    const corner = this.corners.at(sM);
    return corner !== null && sM >= corner.turnInSM && sM <= corner.apexSM;
  }

  private coolingDown(candidate: Candidate, nowMonoMs: number): boolean {
    const last = this.lastCue;
    if (!last || candidate.priority > last.priority) return false;
    return nowMonoMs - last.decidedMonoMs < this.config.cue.cooldownMs;
  }

  private admitted(candidates: Candidate[], step: Step): Candidate[] {
    const admitted: Candidate[] = [];
    for (const entry of candidates) {
      const { muteKey } = entry.target;
      const why = muteKey !== null && this.settings.mutedKeys.has(muteKey) ? 'muted' : entry.gate;
      if (why) {
        this.drop(entry, why, step);
        continue;
      }
      if (entry.opens) this.open(entry.opens);
      if (entry.held) this.openWindows.get(entry.eventKey)!.lastWhy = entry.held;
      else admitted.push(entry);
    }
    return admitted;
  }

  private choose(candidates: Candidate[], step: Step): Spoken | null {
    const ordered = this.admitted(candidates, step).sort((a, b) => b.priority - a.priority || (a.target.sM ?? 0) - (b.target.sM ?? 0));
    let chosen: Candidate | null = null;
    for (const candidate of ordered) {
      const blocked: SuppressReason | null = this.coolingDown(candidate, step.input.nowMonoMs)
        ? 'cooldown'
        : chosen
          ? 'lower-priority'
          : null;
      if (!blocked) chosen = candidate;
      this.record(candidate, blocked, step);
    }
    return chosen ? this.cue(chosen, step.input) : null;
  }

  private record(candidate: Candidate, blocked: SuppressReason | null, step: Step): void {
    const window = this.openWindows.get(candidate.eventKey);
    if (window && blocked) {
      window.lastWhy = blocked;
      return;
    }
    this.drop(candidate, blocked, step);
  }

  private drop(candidate: Candidate, why: SuppressReason | null, step: Step): void {
    this.openWindows.delete(candidate.eventKey);
    for (const event of this.eventsByKey.get(candidate.eventKey) ?? []) this.settled.add(event);
    for (const brake of this.bigStopsByKey.get(candidate.eventKey) ?? []) this.settledBigStops.add(brake);
    if (why) step.suppressed.push({ eventKey: candidate.eventKey, why, target: candidate.target });
  }

  private cue(speech: Speech, input: CoachInput): Spoken {
    const cue = makeCue({ ...speech, generation: this.generation, decidedMonoMs: input.nowMonoMs, deviceDelayMs: input.deviceDelayMs }, this.config);
    return { cue, target: speech.target };
  }
}
