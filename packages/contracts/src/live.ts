import { z } from 'zod';
import { MAX_OUTPUT_LATENCY_MS } from './constants.ts';

export const cueKindSchema = z.enum([
  'hard-brake',
  'brake',
  'light-brake',
  'ease-off',
  'throttle',
  'full-throttle',
  'keep-left',
  'keep-right',
  'tighter',
  'big-stop'
]);

export type CueKind = z.infer<typeof cueKindSchema>;

export type LiveCueKind = CueKind | 'guidance-paused' | 'guidance-resumed' | 'focus';

export type WordedCueKind = Exclude<LiveCueKind, 'focus'>;

export const CUE_WORDS: Record<WordedCueKind, string> = {
  'hard-brake': 'Hard brake',
  brake: 'Brake',
  'light-brake': 'Light brake',
  'ease-off': 'Ease off',
  throttle: 'Throttle',
  'full-throttle': 'Full throttle',
  'keep-left': 'Keep left',
  'keep-right': 'Keep right',
  tighter: 'Tighter',
  'big-stop': 'Big stop',
  'guidance-paused': 'Guidance paused',
  'guidance-resumed': 'Guidance resumed'
};

export type LiveCue = {
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

export type GuidanceMode = 'active' | 'suspended' | 'waiting-for-restart';

export type GuidanceReason = 'untrusted-position' | 'target-incompatible' | 'awaiting-restart' | null;

export type LiveGuidance = { mode: GuidanceMode; reason: GuidanceReason };

export type ConnectionState = 'connected' | 'stale' | 'disconnected';

export type LiveMode = 'idle' | 'capturing' | 'armed' | 'driving' | 'paused' | 'finished';

export type LiveState = {
  seq: number;
  connection: ConnectionState;
  mode: LiveMode;
  exerciseId: string | null;
  attemptNumber: number | null;
  generation: number;
  guidance: LiveGuidance;
  voiceDeviceId: string | null;
  voiceReady: boolean;
  recordingComplete: boolean;
  storageError: string | null;
  sM: number | null;
  speedMps: number | null;
  lastCue: LiveCue | null;
  nextCue: { text: string; inM: number } | null;
  lastAttemptId: string | null;
  referenceId: string | null;
  gapMs: number | null;
  startMissed: boolean;
};

export type ServerMsg =
  | { type: 'state'; state: LiveState }
  | { type: 'cue'; cue: LiveCue; sentMs: number }
  | { type: 'cancel'; generation: number }
  | { type: 'ping'; id: number; serverMs: number };

export const cueOutcomeSchema = z.enum(['played', 'expired', 'cancelled', 'failed']);

export type CueOutcome = z.infer<typeof cueOutcomeSchema>;

export const STATE_RATES = [15, 30, 60] as const;

export type StateRate = (typeof STATE_RATES)[number];

export const clientMsgSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pong'), id: z.number().int().nonnegative(), outputLatencyMs: z.number().min(0).max(MAX_OUTPUT_LATENCY_MS) }),
  z.object({ type: z.literal('claim-voice'), deviceId: z.string().min(1).max(100), ready: z.boolean() }),
  z.object({ type: z.literal('release-voice') }),
  z.object({ type: z.literal('state-rate'), perSecond: z.literal(STATE_RATES) }),
  z.object({
    type: z.literal('cue-outcome'),
    cueId: z.string().min(1).max(200),
    outcome: cueOutcomeSchema,
    startDelayMs: z.number().min(0).max(60000).nullable()
  })
]);

export type ClientMsg = z.infer<typeof clientMsgSchema>;

export const armTrainingSchema = z.object({ exerciseId: z.uuid() }).strict();

export type ArmTrainingRequest = z.infer<typeof armTrainingSchema>;

export const devReplaySchema = z.object({ fixture: z.string().regex(/^[a-z0-9-]+$/).max(100) }).strict();

export type DevReplayRequest = z.infer<typeof devReplaySchema>;

export type ArmResponse = { captureId: string; exerciseId: string; referenceId: string };
