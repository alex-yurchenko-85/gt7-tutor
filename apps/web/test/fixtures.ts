import type { CatalogueListEntry, CornerInfo, Exercise, ExerciseStep, ReferenceCue, ReferenceInfo, ReferenceTrace } from '@gt7/contracts';
import { ApiStub, signedIn, USER } from './support.tsx';

export const EXERCISE_ID = 'ex-1';
export const REFERENCE_ID = 'ref-demo';

export function exercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: EXERCISE_ID,
    catalogueId: 'brand-yangwang-racing-lines',
    family: 'Brand Experience',
    name: 'Yangwang Experience / Racing Lines',
    carId: 3602,
    conditions: {},
    targets: {},
    mutedCues: [],
    speakTargets: true,
    cueOffsetsMs: {},
    sideCueDistanceM: 2,
    activeReferenceId: REFERENCE_ID,
    status: 'ready',
    step: 2,
    completeAttempts: 0,
    bestMs: null,
    createdAt: '2026-11-16T10:00:00.000Z',
    ...overrides
  };
}

export function exerciseAtStep(step: ExerciseStep): Exercise {
  return exercise({ step, activeReferenceId: step === 1 ? null : REFERENCE_ID, status: step === 1 ? 'new' : step === 2 ? 'ready' : 'practising' });
}

export const TRACE: ReferenceTrace = {
  gridM: 2,
  lengthM: 20,
  timeMs: 27000,
  x: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
  z: [0, 1, 2, 2, 2, 1, 0, -1, -2, -2, -2],
  speedKph: [100, 110, 120, 110, 85, 80, 90, 100, 110, 120, 130]
};

export const CUES: ReferenceCue[] = [
  { key: 'brake@332', kind: 'brake', sM: 332, endSM: 478, targetSpeedKph: 85, phrase: 'Hard brake. Eighty five', voice: 'hard-brake', bigStop: true, muted: false },
  { key: 'throttle@491', kind: 'throttle', sM: 491, endSM: null, targetSpeedKph: 95, phrase: 'Full throttle', voice: 'full-throttle', bigStop: false, muted: false },
  { key: 'ease-off@600', kind: 'ease-off', sM: 600, endSM: null, targetSpeedKph: null, phrase: 'Ease off', voice: 'ease-off', bigStop: false, muted: false }
];

export const CORNERS: CornerInfo[] = [
  { number: 1, turnInSM: 461, apexSM: 519, radiusM: 43.05, apexSpeedKph: 88.96 },
  { number: 2, turnInSM: 691, apexSM: 737, radiusM: 65.8, apexSpeedKph: 109.99 },
  { number: 3, turnInSM: 834, apexSM: 870, radiusM: 84.2, apexSpeedKph: 122.5 }
];

export function reference(overrides: Partial<ReferenceInfo> = {}): ReferenceInfo {
  return {
    id: REFERENCE_ID,
    exerciseId: EXERCISE_ID,
    captureId: 'cap-demo',
    first: 352,
    last: 1897,
    origin: 'demo',
    startKind: 'flying',
    gameVersion: '1.65',
    needsCheck: false,
    active: true,
    attemptCount: 2,
    createdAt: '2026-11-16T10:00:00.000Z',
    ...overrides
  };
}

export function catalogueEntry(overrides: Partial<CatalogueListEntry>): CatalogueListEntry {
  return {
    id: 'entry',
    family: 'Licence',
    collection: 'National B',
    code: null,
    name: 'Entry',
    track: null,
    circuitId: null,
    car: null,
    targets: null,
    sections: null,
    source: 'Gran Turismo Wiki',
    support: 'unverified',
    exerciseId: null,
    status: null,
    ...overrides
  };
}

export function rememberExercise(id = EXERCISE_ID): void {
  window.localStorage.setItem(`gt7.currentExercise.${USER.id}`, id);
}

export function exerciseApi(current: Exercise = exercise()): ApiStub {
  return signedIn(new ApiStub())
    .on('GET /api/exercises', [current])
    .on(`GET /api/exercises/${current.id}`, current)
    .on(`GET /api/references/${REFERENCE_ID}/path`, TRACE)
    .on(`GET /api/references/${REFERENCE_ID}/cues`, CUES)
    .on(`GET /api/references/${REFERENCE_ID}/corners`, CORNERS)
    .on(`GET /api/exercises/${current.id}/reactions`, [])
    .on(`GET /api/exercises/${current.id}/recurring`, [])
    .on(`GET /api/exercises/${current.id}/references`, [reference()])
    .on(`GET /api/exercises/${current.id}/attempts`, { bestMs: null, days: [] })
    .on('GET /api/captures', []);
}
