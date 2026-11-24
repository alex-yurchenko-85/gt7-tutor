import { z } from 'zod';
import type { ExerciseStatusName } from './catalogue.ts';
import { CUE_OFFSET_MAX_MS, CUE_OFFSET_MIN_MS, CUE_OFFSET_STEP_MS, RECURRING_DEFAULT_LAST, TARGET_MAX_MS } from './constants.ts';

export const capturePurposeSchema = z.enum(['demo', 'player', 'race']);

export type CapturePurpose = z.infer<typeof capturePurposeSchema>;

export type RawRange = { first: number; last: number };

export type EventKind = 'brake' | 'ease-off' | 'throttle';

const PLACED_KINDS = ['brake', 'ease-off', 'throttle', 'big-stop', 'keep-left', 'keep-right'] as const;

export type PlacedKind = (typeof PLACED_KINDS)[number];

export type CueEventKind = PlacedKind | 'tighter' | 'guidance' | 'focus';

function isPlacedKind(kind: string | null): kind is PlacedKind {
  return PLACED_KINDS.some(placed => placed === kind);
}

export function eventKey(kind: PlacedKind, sM: number): string {
  return `${kind}@${Math.round(sM)}`;
}

export function eventKeyKind(key: string): CueEventKind | null {
  if (key === 'focus') return 'focus';
  if (key.startsWith('guidance-')) return 'guidance';
  const at = key.indexOf('@');
  const kind = at > 0 ? key.slice(0, at) : null;
  return kind === 'tighter' || isPlacedKind(kind) ? kind : null;
}

export function eventKeyPlace(key: string): number | null {
  return isPlacedKind(eventKeyKind(key)) ? Number(key.slice(key.indexOf('@') + 1)) : null;
}

const eventKeySchema = z.string().min(1).max(60);

const cueOffsetMsSchema = z.number().int().min(CUE_OFFSET_MIN_MS).max(CUE_OFFSET_MAX_MS).multipleOf(CUE_OFFSET_STEP_MS);

export const createExerciseSchema = z.union([
  z.object({ catalogueId: z.string().min(1).max(200) }).strict(),
  z
    .object({
      family: z.string().trim().min(1).max(60),
      name: z.string().trim().min(1).max(120)
    })
    .strict()
]);

export type CreateExerciseRequest = z.infer<typeof createExerciseSchema>;

export const SIDE_CUE_DISTANCES_M = [0.5, 1, 1.5, 2, 2.5, 3] as const;

export const sideCueDistanceSchema = z.union([z.null(), z.number().refine(value => SIDE_CUE_DISTANCES_M.some(distanceM => distanceM === value))]);

export const updateExerciseSchema = z
  .object({
    mutedCues: z.array(eventKeySchema).max(500),
    speakTargets: z.boolean(),
    cueOffsetsMs: z.record(eventKeySchema, cueOffsetMsSchema),
    sideCueDistanceM: sideCueDistanceSchema,
    targetMs: z.number().int().positive().max(TARGET_MAX_MS).nullable()
  })
  .partial()
  .strict();

export type UpdateExerciseRequest = z.infer<typeof updateExerciseSchema>;

export type Exercise = {
  id: string;
  catalogueId: string | null;
  family: string;
  name: string;
  collection: string | null;
  code: string | null;
  carId: number | null;
  targetMs: number | null;
  mutedCues: string[];
  speakTargets: boolean;
  cueOffsetsMs: Record<string, number>;
  sideCueDistanceM: number | null;
  activeReferenceId: string | null;
  status: ExerciseStatusName;
  attemptCount: number;
  referenceCount: number;
  completeAttempts: number;
  bestMs: number | null;
  targetGapMs: number | null;
  createdAt: string;
  lastAttemptAt: string | null;
};

export const connectionSettingsSchema = z.object({ ps5Ip: z.ipv4() }).strict();

export type ConnectionSettings = z.infer<typeof connectionSettingsSchema>;

export const gameVersionSchema = z.object({ version: z.string().trim().min(1).max(40) }).strict();

export type GameVersionRequest = z.infer<typeof gameVersionSchema>;

export type Settings = { ps5Ip: string | null; gameVersion: string | null };

export const createCaptureSchema = z
  .object({
    exerciseId: z.uuid(),
    purpose: z.enum(['demo', 'player'])
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
  active: boolean;
};

export const referenceProposalSchema = z.object({ captureIds: z.array(z.uuid()).min(1).max(2) }).strict();

export type ReferenceProposalRequest = z.infer<typeof referenceProposalSchema>;

export type ReferenceProposal = {
  ranges: { captureId: string; first: number; last: number }[];
  sampleCount: number;
  ambiguous: boolean;
  evidence: string[];
  timeMs: number;
};

export const createReferenceSchema = z
  .object({
    exerciseId: z.uuid(),
    captureId: z.uuid(),
    first: z.number().int().nonnegative(),
    last: z.number().int().nonnegative()
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
  kind: EventKind;
  sM: number;
  endSM: number | null;
  targetSpeedKph: number | null;
  phraseClips: string[] | null;
  voice: string;
  bigStop: boolean;
  muted: boolean;
  clip: string;
  followClip: string | null;
};

export type CornerInfo = { number: number; turnInSM: number; apexSM: number; radiusM: number; apexSpeedMps: number; zoneFromSM: number; zoneToSM: number; brakeToSM: number | null; brakeAtTurnIn: number | null; lowSpeedSM: number | null; lowSpeedMps: number | null; lowSpeedAtApex: boolean };

export type CornerReview = CornerInfo & { outsideM: number | null; speedMps: number | null; attemptLowSM: number | null; attemptLowMps: number | null };

export type BrakeReactionSummary = { eventKey: string; medianMs: number; count: number };

export type AttemptReaction = { eventKey: string; reactionMs: number };

export const FOCUS_PARTS = ['approach', 'entry', 'exit'] as const;

export type FocusPart = (typeof FOCUS_PARTS)[number];

export type FocusSummary = { turn: number; part: FocusPart; cause: FindingKindName | null; clip: string | null };

export type StorageUse = { rawBytes: number; profileRawBytes: number; profileCaptures: number };

export type CleanupResult = { captures: number; bytesBefore: number; bytesAfter: number };

export const deleteAttemptsSchema = z.object({ ids: z.array(z.uuid()).min(1).max(500) }).strict();

export type DeleteAttemptsRequest = z.infer<typeof deleteAttemptsSchema>;

export type DeleteAttemptsResult = { deleted: number };

export const deleteHistorySchema = z
  .object({ scope: z.enum(['exercise', 'attempts', 'everything']), exerciseId: z.uuid().optional(), cleanup: z.boolean() })
  .strict()
  .refine(body => (body.scope === 'exercise') === (body.exerciseId !== undefined), { message: 'exerciseId belongs to the exercise scope only' });

export type DeleteHistoryRequest = z.infer<typeof deleteHistorySchema>;

export type DeleteHistoryResult = { attempts: number; references: number; races: number; cleanup: CleanupResult | null };

export const removeExercisesSchema = z.object({ ids: z.array(z.uuid()).min(1).max(500), cleanup: z.boolean() }).strict();

export type RemoveExercisesRequest = z.infer<typeof removeExercisesSchema>;

export type RemoveExercisesResult = { exercises: number; attempts: number; references: number; cleanup: CleanupResult | null };

export type DeleteProfileResult = { exercises: number; attempts: number; references: number; races: number; cleanup: CleanupResult };

export const findingKindSchema = z.enum(['brake-early', 'brake-late', 'slow-corner', 'throttle-late', 'off-line', 'wide-apex', 'low-point-early', 'low-point-late']);

export type FindingKindName = z.infer<typeof findingKindSchema>;

export type Difference = { kind: FindingKindName; eventKey: string | null; sM: number; size: number; unit: 'm' | 'm/s'; turn: number | null };

export type TurnLossInfo = { turn: number; fromSM: number; toSM: number; lostMs: number | null };

export type RecurringDifference = Difference & { count: number; of: number; medianSize: number };

type AttemptSummaryBase = {
  id: string;
  exerciseId: string;
  number: number;
  referenceId: string;
  captureId: string;
  first: number;
  last: number;
  reason: string | null;
  gapToBestMs: number | null;
  largestDifference: Difference | null;
  focus: FocusSummary | null;
  startedAt: string;
};

export type AttemptSummary = AttemptSummaryBase & ({ completion: 'complete'; timeMs: number } | { completion: 'aborted'; timeMs: null });

export type AttemptDay = { date: string; bestMs: number | null; attempts: AttemptSummary[] };

export type AttemptList = { bestMs: number | null; days: AttemptDay[] };

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

export type ReviewEvent = { key: string; kind: EventKind; sM: number; endSM: number | null; targetSpeedKph: number | null };

export type AttemptReview = {
  referenceId: string;
  gridM: number;
  lengthM: number;
  referenceTimeMs: number;
  reference: ReviewSeries;
  attempt: ReviewSeries;
  referenceEvents: ReviewEvent[];
  attemptEvents: ReviewEvent[];
  findings: Difference[];
  turnLosses: TurnLossInfo[];
  cues: StoredCueEvent[];
  corners: CornerReview[];
  reactions: AttemptReaction[];
};

export const reviewQuerySchema = z.object({ referenceId: z.uuid().optional() });

export type ReviewQuery = z.infer<typeof reviewQuerySchema>;

export const recurringQuerySchema = z.object({ last: z.coerce.number().int().min(1).max(100).default(RECURRING_DEFAULT_LAST) });

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

export type ReferenceTrace = { gridM: number; lengthM: number; timeMs: number; x: number[]; z: number[]; speedMps: number[] };

export type PreviewDropReason = 'voice-busy' | 'too-late' | 'already-done' | 'other';

export type PreviewCue = { key: string; rowKey: string | null; clip: string; followClip: string | null; atMs: number };

export type PreviewDrop = { rowKey: string; reason: PreviewDropReason; afterRowKey: string | null };

export type CuePreview = { timeMs: number; gridM: number; gridTimeMs: number[]; cues: PreviewCue[]; dropped: PreviewDrop[] };
