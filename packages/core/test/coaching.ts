import type { LiveGuidance, Sample } from '@gt7/contracts';
import type { Cue } from '../src/cue-factory.ts';
import { Coach, type CoachInput, type CoachSettings, type CueTarget, type Suppressed } from '../src/coach.ts';
import { DEFAULT_CONFIG, DEFAULT_SIDE_CUE_DISTANCE_M, type CoreConfig } from '../src/config.ts';
import { estimatedPhraseMs } from '../src/cue-text.ts';
import type { ReferenceCueEvent } from '../src/cue-events.ts';
import { Matcher, type Match } from '../src/match.ts';
import type { ReferencePath } from '../src/reference.ts';
import { analysisOf, profiledPath } from './paths.ts';
import { FRAME_MS, syntheticSample } from './synthetic.ts';

const MAX_LATERAL_STEP_M = 0.1;

export type CarState = {
  speedKph: number;
  lateralM?: number;
  brake?: number;
  throttle?: number;
  velocityAngleDeg?: number;
  paused?: boolean;
};

export function simulate(lengthM: number, at: (sM: number, index: number) => CarState, startM = 0.5): Sample[] {
  const samples: Sample[] = [];
  let x = startM;
  let z = at(startM, 0).lateralM ?? 0;
  for (let index = 0; x <= lengthM; index++) {
    const state = at(x, index);
    const targetZ = state.lateralM ?? 0;
    z += Math.max(-MAX_LATERAL_STEP_M, Math.min(MAX_LATERAL_STEP_M, targetZ - z));
    const speedMps = state.speedKph / 3.6;
    const angle = ((state.velocityAngleDeg ?? 0) * Math.PI) / 180;
    samples.push(
      syntheticSample({
        rawIndex: index,
        packetId: index + 1,
        receivedMonoMs: index * FRAME_MS,
        position: { x, y: 0, z },
        velocity: { x: speedMps * Math.cos(angle), y: 0, z: speedMps * Math.sin(angle) },
        speedMps,
        brake: state.brake ?? 0,
        throttle: state.throttle ?? 1,
        paused: state.paused ?? false,
        flags: state.paused ? 11 : 9
      })
    );
    if (!state.paused) x += (speedMps * FRAME_MS) / 1000;
  }
  return samples;
}

type EventTone = Partial<Pick<ReferenceCueEvent, 'voice' | 'bigStop'>>;

export function event(
  kind: ReferenceCueEvent['kind'],
  sM: number,
  targetSpeedKph: number | null,
  endSM: number | null = null,
  tone: EventTone = {}
): ReferenceCueEvent {
  return { key: `${kind}@${Math.round(sM)}`, kind, sM, endSM, targetSpeedKph, voice: kind, bigStop: false, ...tone };
}

export type Decision = { cue: Cue; target: CueTarget; sM: number | null; index: number };

export type CoachRun = {
  cues: Decision[];
  suppressed: (Suppressed & { index: number })[];
  guidance: { index: number; state: LiveGuidance }[];
  matches: (Match | null)[];
};

export type RunOptions = {
  config?: CoreConfig;
  deviceDelayMs?: number;
  mutedKeys?: ReadonlySet<string>;
  speakTargets?: boolean;
  offsetsMs?: ReadonlyMap<string, number>;
  sideCueDistanceM?: number | null;
  generation?: number;
  coach?: Coach;
  input?: (input: CoachInput, index: number) => CoachInput;
};

export function settingsOf(options: RunOptions = {}): CoachSettings {
  return {
    mutedKeys: options.mutedKeys ?? new Set(),
    speakTargets: options.speakTargets ?? true,
    offsetsMs: options.offsetsMs ?? new Map(),
    sideCueDistanceM: options.sideCueDistanceM === undefined ? DEFAULT_SIDE_CUE_DISTANCE_M : options.sideCueDistanceM
  };
}

export function runCoach(path: ReferencePath, events: ReferenceCueEvent[], samples: Sample[], options: RunOptions = {}): CoachRun {
  const config = options.config ?? DEFAULT_CONFIG;
  const matcher = new Matcher(path, config);
  const coach = options.coach ?? new Coach(analysisOf(path, events, config), config, settingsOf(options));
  const run: CoachRun = { cues: [], suppressed: [], guidance: [], matches: [] };
  let lastGuidance = '';
  samples.forEach((sample, index) => {
    const match = matcher.step(sample);
    run.matches.push(match);
    const base: CoachInput = {
      sample,
      match,
      nowMonoMs: sample.receivedMonoMs,
      generation: options.generation ?? 1,
      deviceDelayMs: options.deviceDelayMs ?? 60,
      phraseMs: estimatedPhraseMs
    };
    const output = coach.step(options.input ? options.input(base, index) : base);
    if (output.cue && output.target) run.cues.push({ cue: output.cue, target: output.target, sM: match?.sM ?? null, index });
    for (const entry of output.suppressed) run.suppressed.push({ ...entry, index });
    const key = JSON.stringify(output.guidance);
    if (key !== lastGuidance) run.guidance.push({ index, state: output.guidance });
    lastGuidance = key;
  });
  return run;
}

export function flatPath(lengthM: number, speedKph: (sM: number) => number): ReferencePath {
  return profiledPath(lengthM, sM => ({ speedKph: speedKph(sM), throttle: 1, brake: 0 }));
}

export function decisionFor(run: CoachRun, eventKey: string): string {
  if (run.cues.some(decision => decision.cue.eventKey === eventKey)) return 'cue';
  return run.suppressed.find(entry => entry.eventKey === eventKey)?.why ?? 'none';
}
