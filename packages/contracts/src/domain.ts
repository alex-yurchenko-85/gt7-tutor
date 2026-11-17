import { z } from 'zod';
import type { ExerciseStatusName } from './catalogue.ts';

export const capturePurposeSchema = z.enum(['demo', 'player']);

export type CapturePurpose = z.infer<typeof capturePurposeSchema>;

export const startKindSchema = z.enum(['standing', 'flying']);

export type StartKindName = z.infer<typeof startKindSchema>;

export const exerciseTargetsSchema = z
  .object({
    bronzeMs: z.number().int().positive(),
    silverMs: z.number().int().positive(),
    goldMs: z.number().int().positive()
  })
  .partial();

export type ExerciseTargets = z.infer<typeof exerciseTargetsSchema>;

const conditionsSchema = z.record(z.string().trim().min(1).max(40), z.string().trim().max(200));

const eventKeySchema = z.string().min(1).max(60);

export const CUE_OFFSET_MIN_MS = -500;
export const CUE_OFFSET_MAX_MS = 1000;
export const CUE_OFFSET_STEP_MS = 100;

const cueOffsetMsSchema = z.number().int().min(CUE_OFFSET_MIN_MS).max(CUE_OFFSET_MAX_MS).multipleOf(CUE_OFFSET_STEP_MS);

export const createExerciseSchema = z.union([
  z.object({ catalogueId: z.string().min(1).max(200) }).strict(),
  z
    .object({
      family: z.string().trim().min(1).max(60),
      name: z.string().trim().min(1).max(120),
      conditions: conditionsSchema.default({})
    })
    .strict()
]);

export type CreateExerciseRequest = z.infer<typeof createExerciseSchema>;

export const SIDE_CUE_DISTANCES_M = [0.5, 1, 1.5, 2, 2.5, 3] as const;

export const sideCueDistanceSchema = z.union([z.null(), z.number().refine(value => SIDE_CUE_DISTANCES_M.some(distanceM => distanceM === value))]);

export const updateExerciseSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    conditions: conditionsSchema,
    targets: exerciseTargetsSchema,
    mutedCues: z.array(eventKeySchema).max(500),
    speakTargets: z.boolean(),
    cueOffsetsMs: z.record(eventKeySchema, cueOffsetMsSchema),
    sideCueDistanceM: sideCueDistanceSchema
  })
  .partial()
  .strict();

export type UpdateExerciseRequest = z.infer<typeof updateExerciseSchema>;

export type ExerciseStep = 1 | 2 | 3 | 4;

export type Exercise = {
  id: string;
  catalogueId: string | null;
  family: string;
  name: string;
  carId: number | null;
  conditions: Record<string, string>;
  targets: ExerciseTargets;
  mutedCues: string[];
  speakTargets: boolean;
  cueOffsetsMs: Record<string, number>;
  sideCueDistanceM: number | null;
  activeReferenceId: string | null;
  status: ExerciseStatusName;
  step: ExerciseStep;
  completeAttempts: number;
  bestMs: number | null;
  createdAt: string;
};

export const connectionSettingsSchema = z.object({ ps5Ip: z.ipv4() }).strict();

export type ConnectionSettings = z.infer<typeof connectionSettingsSchema>;

export const gameVersionSchema = z.object({ version: z.string().trim().min(1).max(40) }).strict();

export type GameVersionRequest = z.infer<typeof gameVersionSchema>;

export type Settings = { ps5Ip: string | null; gameVersion: string | null };

export const createCaptureSchema = z
  .object({
    exerciseId: z.uuid(),
    purpose: capturePurposeSchema,
    startAfterS: z.number().min(0).max(120).optional()
  })
  .strict();

export type CreateCaptureRequest = z.infer<typeof createCaptureSchema>;

export type CaptureInfo = {
  id: string;
  exerciseId: string | null;
  purpose: CapturePurpose;
  startedAt: string;
  endedAt: string | null;
  packets: number;
  complete: boolean;
  errorReason: string | null;
  startCueMonoMs: number | null;
  active: boolean;
};

export const referenceProposalSchema = z.object({ captureIds: z.array(z.uuid()).min(2).max(3) }).strict();

export type ReferenceProposalRequest = z.infer<typeof referenceProposalSchema>;

export type ReferenceProposal = {
  ranges: { captureId: string; first: number; last: number }[];
  sampleCount: number;
  ambiguous: boolean;
  evidence: string[];
};

export const createReferenceSchema = z
  .object({
    exerciseId: z.uuid(),
    captureId: z.uuid(),
    first: z.number().int().nonnegative(),
    last: z.number().int().nonnegative(),
    startKind: startKindSchema
  })
  .strict()
  .refine(body => body.last >= body.first, { message: 'last must not be less than first', path: ['last'] });

export type CreateReferenceRequest = z.infer<typeof createReferenceSchema>;

export type ReferenceOrigin = 'demo' | 'attempt';

export type ReferenceInfo = {
  id: string;
  exerciseId: string;
  captureId: string;
  first: number;
  last: number;
  origin: ReferenceOrigin;
  startKind: StartKindName;
  gameVersion: string | null;
  needsCheck: boolean;
  active: boolean;
  attemptCount: number;
  createdAt: string;
};

export const referenceCheckSchema = z.object({ captureId: z.uuid() }).strict();

export type ReferenceCheckRequest = z.infer<typeof referenceCheckSchema>;

export type ReferenceCheckResult = { matched: boolean; range: { first: number; last: number } | null; reference: ReferenceInfo };

export type ReferenceCue = {
  key: string;
  kind: 'brake' | 'ease-off' | 'throttle';
  sM: number;
  endSM: number | null;
  targetSpeedKph: number | null;
  phrase: string | null;
  voice: string;
  bigStop: boolean;
  muted: boolean;
};

export type CornerInfo = { number: number; turnInSM: number; apexSM: number; radiusM: number; apexSpeedKph: number };

export type CornerReview = CornerInfo & { outsideM: number | null; speedKph: number | null };

export type BrakeReactionSummary = { eventKey: string; medianMs: number; count: number };

export type AttemptReaction = { eventKey: string; reactionMs: number };

export type FocusSummary = { text: string; turn: number; kind: FindingKindName };

export type StorageUse = { rawBytes: number; profileRawBytes: number; profileCaptures: number };

export type CleanupResult = { captures: number; bytesBefore: number; bytesAfter: number };

export const medalSchema = z.enum(['bronze', 'silver', 'gold']);

export type MedalName = z.infer<typeof medalSchema>;

export type FindingKindName = 'brake-early' | 'brake-late' | 'slow-corner' | 'throttle-late' | 'off-line' | 'wide-apex';

export type Difference = { kind: FindingKindName; eventKey: string | null; sM: number; size: number; unit: 'm' | 'km/h' };

export type RecurringDifference = Difference & { count: number; of: number; medianSize: number };

export type AttemptSummary = {
  id: string;
  exerciseId: string;
  number: number;
  referenceId: string;
  captureId: string;
  first: number;
  last: number;
  mode: 'baseline' | 'guided';
  completion: 'complete' | 'aborted';
  reason: string | null;
  measuredMs: number | null;
  officialMs: number | null;
  medal: MedalName | null;
  timeMs: number | null;
  gapToBestMs: number | null;
  largestDifference: Difference | null;
  focus: FocusSummary | null;
  startedAt: string;
};

export type AttemptDay = { date: string; bestMs: number | null; attempts: AttemptSummary[] };

export type AttemptList = { bestMs: number | null; days: AttemptDay[] };

export const updateAttemptSchema = z
  .object({ officialMs: z.number().int().positive().max(3600000).nullable(), medal: medalSchema.nullable() })
  .partial()
  .strict();

export type UpdateAttemptRequest = z.infer<typeof updateAttemptSchema>;

export type StoredCueEvent = {
  eventKey: string;
  kind: string;
  targetKph: number | null;
  decidedMonoMs: number;
  outcome: string;
  startDelayMs: number | null;
};

export type ReviewSeries = {
  t: (number | null)[];
  v: (number | null)[];
  th: (number | null)[];
  br: (number | null)[];
  x: (number | null)[];
  z: (number | null)[];
  lat: (number | null)[];
};

export type ReviewEvent = { key: string; kind: 'brake' | 'ease-off' | 'throttle'; sM: number; endSM: number | null; targetSpeedKph: number | null };

export type AttemptReview = {
  referenceId: string;
  gridM: number;
  lengthM: number;
  reference: ReviewSeries;
  attempt: ReviewSeries;
  referenceEvents: ReviewEvent[];
  attemptEvents: ReviewEvent[];
  findings: Difference[];
  cues: StoredCueEvent[];
  corners: CornerReview[];
  reactions: AttemptReaction[];
};

export const reviewQuerySchema = z.object({ referenceId: z.uuid().optional() });

export type ReviewQuery = z.infer<typeof reviewQuerySchema>;

export const recurringQuerySchema = z.object({ last: z.coerce.number().int().min(1).max(100).default(8) });

export type RecurringQuery = z.infer<typeof recurringQuerySchema>;

export type ProgressCollection = { family: string; collection: string; counts: Record<ExerciseStatusName, number> };

export type ProgressExercise = {
  id: string;
  name: string;
  family: string;
  collection: string;
  status: ExerciseStatusName;
  bestMs: number | null;
  bestByDay: { date: string; bestMs: number }[];
};

export type Progress = { collections: ProgressCollection[]; exercises: ProgressExercise[] };

export type ReceptionCheck = { packets: number; decoded: number; durationMs: number; carId: number | null };

export type ReferenceTrace = { gridM: number; lengthM: number; timeMs: number; x: number[]; z: number[]; speedKph: number[] };
