import type { LiveCueKind } from '@gt7/contracts';
import type { CoreConfig } from './config.ts';

export type CueInput = {
  kind: LiveCueKind;
  generation: number;
  eventKey: string;
  clip: string;
  followClip: string | null;
  targetSpeedKph: number | null;
  decidedMonoMs: number;
  deviceDelayMs: number;
};

export type Cue = {
  id: string;
  eventKey: string;
  kind: LiveCueKind;
  targetSpeedKph: number | null;
  clip: string;
  followClip: string | null;
  generation: number;
  priority: number;
  decidedMonoMs: number;
  ttlMs: number;
};

export function cuePriority(kind: LiveCueKind, config: CoreConfig): number {
  const priority = config.cue.priority;
  switch (kind) {
    case 'hard-brake':
    case 'brake':
    case 'light-brake':
      return priority.brake;
    case 'big-stop':
      return priority.bigStop;
    case 'ease-off':
      return priority.easeOff;
    case 'keep-left':
    case 'keep-right':
    case 'tighter':
      return priority.position;
    case 'throttle':
    case 'full-throttle':
      return priority.throttle;
    case 'countdown':
      return priority.countdown;
    case 'guidance-paused':
    case 'guidance-resumed':
    case 'focus':
      return priority.system;
  }
}

export function makeCue(input: CueInput, config: CoreConfig): Cue {
  const countdown = input.kind === 'countdown';
  return {
    id: countdown ? input.eventKey : `${input.generation}:${input.eventKey}`,
    eventKey: input.eventKey,
    kind: input.kind,
    targetSpeedKph: input.targetSpeedKph,
    clip: input.clip,
    followClip: input.followClip,
    generation: input.generation,
    priority: cuePriority(input.kind, config),
    decidedMonoMs: input.decidedMonoMs,
    ttlMs: countdown ? config.cue.countdownTtlMs : config.cue.ttlBaseMs + input.deviceDelayMs
  };
}
