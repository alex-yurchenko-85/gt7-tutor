import { z } from 'zod';

export type LiveCueKind =
  | 'hard-brake'
  | 'brake'
  | 'light-brake'
  | 'ease-off'
  | 'throttle'
  | 'full-throttle'
  | 'keep-left'
  | 'keep-right'
  | 'tighter'
  | 'big-stop'
  | 'guidance-paused'
  | 'guidance-resumed'
  | 'focus';

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

export type LiveGuidance = {
  mode: 'active' | 'suspended' | 'waiting-for-restart';
  reason: 'untrusted-position' | 'target-incompatible' | 'model-uncertain' | 'awaiting-restart' | null;
};

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
  speedKph: number | null;
  lastCue: LiveCue | null;
  nextCue: { text: string; inM: number } | null;
  lastAttemptId: string | null;
  trainingMode: TrainingMode | null;
  referenceId: string | null;
};

export type ServerMsg =
  | { type: 'state'; state: LiveState }
  | { type: 'cue'; cue: LiveCue; sentMs: number }
  | { type: 'cancel'; generation: number }
  | { type: 'ping'; id: number; serverMs: number };

export const cueOutcomeSchema = z.enum(['played', 'expired', 'cancelled', 'failed']);

export type CueOutcome = z.infer<typeof cueOutcomeSchema>;

export const clientMsgSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pong'), id: z.number().int().nonnegative(), outputLatencyMs: z.number().min(0).max(2000) }),
  z.object({ type: z.literal('claim-voice'), deviceId: z.string().min(1).max(100), ready: z.boolean() }),
  z.object({ type: z.literal('release-voice') }),
  z.object({
    type: z.literal('cue-outcome'),
    cueId: z.string().min(1).max(200),
    outcome: cueOutcomeSchema,
    startDelayMs: z.number().min(0).max(60000).nullable()
  })
]);

export type ClientMsg = z.infer<typeof clientMsgSchema>;

export const trainingModeSchema = z.enum(['baseline', 'guided']);

export type TrainingMode = z.infer<typeof trainingModeSchema>;

export const armTrainingSchema = z
  .object({ exerciseId: z.uuid(), mode: trainingModeSchema, confirmNoVoice: z.boolean().optional() })
  .strict();

export type ArmTrainingRequest = z.infer<typeof armTrainingSchema>;

export const manualActionSchema = z.object({ action: z.enum(['start', 'finish', 'abort']) }).strict();

export type ManualActionRequest = z.infer<typeof manualActionSchema>;

export const devReplaySchema = z.object({ fixture: z.string().regex(/^[a-z0-9-]+$/).max(100) }).strict();

export type DevReplayRequest = z.infer<typeof devReplaySchema>;

export type ArmResponse = { captureId: string; exerciseId: string; referenceId: string; mode: TrainingMode };
