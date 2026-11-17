import type {
  AppInfo,
  BrakeReactionSummary,
  CornerInfo,
  AttemptList,
  AttemptReview,
  AttemptSummary,
  AuthState,
  CaptureInfo,
  CatalogueCheckResponse,
  CatalogueInfo,
  CatalogueListEntry,
  CatalogueQuery,
  CleanupResult,
  Circuit,
  CreateCaptureRequest,
  CreateExerciseRequest,
  CreateReferenceRequest,
  DemoAttemptResponse,
  Exercise,
  ArmResponse,
  ArmTrainingRequest,
  ManualActionRequest,
  ProfileCredentials,
  ProfileResponse,
  Progress,
  ReceptionCheck,
  RecurringDifference,
  ReferenceCheckResult,
  ReferenceCue,
  ReferenceInfo,
  ReferenceProposal,
  ReferenceTrace,
  Settings,
  StorageUse,
  UpdateAttemptRequest,
  UpdateExerciseRequest
} from '@gt7/contracts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type ErrorBody = { code?: unknown; reason?: unknown; message?: unknown };

function messageOf(body: ErrorBody | null, status: number): string {
  if (typeof body?.reason === 'string') return body.reason;
  if (typeof body?.message === 'string') return body.message;
  if (Array.isArray(body?.message)) return body.message.join(' ');
  return `The server answered with status ${status}.`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: { accept: 'application/json' } };
  if (body !== undefined) {
    init.headers = { accept: 'application/json', 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`/api${path}`, init);
  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const errorBody = parsed as ErrorBody | null;
    throw new ApiError(response.status, typeof errorBody?.code === 'string' ? errorBody.code : null, messageOf(errorBody, response.status));
  }
  return parsed as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString()}` : '';
}

export const api = {
  authState: () => request<AuthState>('GET', '/auth/state'),
  appInfo: () => request<AppInfo>('GET', '/app-info'),
  demoAttempt: () => request<DemoAttemptResponse>('POST', '/demo/attempt'),
  createFirstProfile: (credentials: ProfileCredentials) => request<ProfileResponse>('POST', '/auth/first-profile', credentials),
  signIn: (credentials: ProfileCredentials) => request<ProfileResponse>('POST', '/auth/sign-in', credentials),
  signOut: () => request<void>('POST', '/auth/sign-out'),
  createProfile: (credentials: ProfileCredentials) => request<ProfileResponse>('POST', '/profiles', credentials),

  settings: () => request<Settings>('GET', '/settings'),
  setConsoleAddress: (ps5Ip: string) => request<Settings>('PUT', '/settings/connection', { ps5Ip }),
  checkReception: () => request<ReceptionCheck>('POST', '/settings/connection/check'),
  setGameVersion: (version: string) => request<Settings>('PUT', '/settings/game-version', { version }),
  storage: () => request<StorageUse>('GET', '/storage'),
  cleanup: () => request<CleanupResult>('POST', '/storage/cleanup'),

  catalogue: (filters: CatalogueQuery = {}) =>
    request<CatalogueListEntry[]>('GET', `/catalogue${query({ ...filters })}`),
  catalogueInfo: () => request<CatalogueInfo>('GET', '/catalogue/info'),
  circuits: () => request<Circuit[]>('GET', '/catalogue/circuits'),
  checkCatalogue: () => request<CatalogueCheckResponse>('POST', '/catalogue/update/check'),
  applyCatalogue: (token: string) => request<{ ok: true }>('POST', '/catalogue/update/apply', { token }),
  restoreCatalogue: () => request<{ ok: true }>('POST', '/catalogue/update/restore'),
  carName: (carId: number) => request<{ id: number; name: string }>('GET', `/cars/${carId}`),

  exercises: () => request<Exercise[]>('GET', '/exercises'),
  exercise: (id: string) => request<Exercise>('GET', `/exercises/${id}`),
  createExercise: (body: CreateExerciseRequest) => request<Exercise>('POST', '/exercises', body),
  updateExercise: (id: string, body: UpdateExerciseRequest) => request<Exercise>('PATCH', `/exercises/${id}`, body),

  captures: () => request<CaptureInfo[]>('GET', '/captures'),
  capture: (id: string) => request<CaptureInfo>('GET', `/captures/${id}`),
  startCapture: (body: CreateCaptureRequest) => request<CaptureInfo>('POST', '/captures', body),
  stopCapture: (id: string) => request<CaptureInfo>('POST', `/captures/${id}/stop`),

  proposeReference: (exerciseId: string, captureIds: string[]) =>
    request<ReferenceProposal[]>('POST', `/exercises/${exerciseId}/reference-proposals`, { captureIds }),
  references: (exerciseId: string) => request<ReferenceInfo[]>('GET', `/exercises/${exerciseId}/references`),
  createReference: (body: CreateReferenceRequest) => request<ReferenceInfo>('POST', '/references', body),
  activateReference: (id: string) => request<ReferenceInfo>('POST', `/references/${id}/activate`),
  deleteReference: (id: string) => request<{ ok: true }>('DELETE', `/references/${id}`),
  checkReference: (id: string, captureId: string) => request<ReferenceCheckResult>('POST', `/references/${id}/check`, { captureId }),
  referenceTrace: (id: string) => request<ReferenceTrace>('GET', `/references/${id}/path`),
  referenceCues: (id: string) => request<ReferenceCue[]>('GET', `/references/${id}/cues`),
  referenceCorners: (id: string) => request<CornerInfo[]>('GET', `/references/${id}/corners`),
  reactions: (exerciseId: string) => request<BrakeReactionSummary[]>('GET', `/exercises/${exerciseId}/reactions`),
  promoteAttempt: (id: string) => request<ReferenceInfo>('POST', `/attempts/${id}/promote`),

  arm: (body: ArmTrainingRequest) => request<ArmResponse>('POST', '/training/arm', body),
  disarm: () => request<unknown>('POST', '/training/disarm'),
  manual: (action: ManualActionRequest['action']) => request<unknown>('POST', '/training/manual', { action }),
  devReplay: (fixture: string) => request<unknown>('POST', '/dev/replay', { fixture }),

  attempts: (exerciseId: string) => request<AttemptList>('GET', `/exercises/${exerciseId}/attempts`),
  attempt: (id: string) => request<AttemptSummary>('GET', `/attempts/${id}`),
  updateAttempt: (id: string, body: UpdateAttemptRequest) => request<AttemptSummary>('PATCH', `/attempts/${id}`, body),
  review: (id: string, referenceId?: string) => request<AttemptReview>('GET', `/attempts/${id}/review${query({ referenceId })}`),
  recurring: (exerciseId: string, last = 8) => request<RecurringDifference[]>('GET', `/exercises/${exerciseId}/recurring${query({ last })}`),
  progress: () => request<Progress>('GET', '/progress')
};

export type Api = typeof api;
