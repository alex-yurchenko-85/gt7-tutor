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
  CleanupResult,
  CreateCaptureRequest,
  CreateExerciseRequest,
  CreateReferenceRequest,
  DeleteAttemptsResult,
  DeleteHistoryRequest,
  DeleteHistoryResult,
  RemoveExercisesRequest,
  RemoveExercisesResult,
  DemoAttemptResponse,
  Exercise,
  ArmResponse,
  ArmTrainingRequest,
  ChangePasswordRequest,
  DeleteProfileRequest,
  DeleteProfileResult,
  ProfileCard,
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
  UpdateExerciseRequest
} from '@gt7/contracts';
import { RECURRING_DEFAULT_LAST } from '@gt7/contracts';

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

const shared = new Map<string, Promise<unknown>>();

function sharedRequest<T>(path: string, keep: boolean): Promise<T> {
  const known = shared.get(path);
  if (known) return known as Promise<T>;
  const loading = request<T>('GET', path);
  shared.set(path, loading);
  const forget = () => {
    if (shared.get(path) === loading) shared.delete(path);
  };
  loading.then(keep ? undefined : forget, forget);
  return loading;
}

export function forgetSharedRequests(): void {
  shared.clear();
}

function query(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString()}` : '';
}

export const api = {
  authState: () => request<AuthState>('GET', '/auth/state'),
  authProfiles: () => request<ProfileCard[]>('GET', '/auth/profiles'),
  appInfo: () => request<AppInfo>('GET', '/app-info'),
  demoAttempt: () => request<DemoAttemptResponse>('POST', '/demo/attempt'),
  createFirstProfile: (credentials: ProfileCredentials) => request<ProfileResponse>('POST', '/auth/first-profile', credentials),
  signIn: (credentials: ProfileCredentials) => request<ProfileResponse>('POST', '/auth/sign-in', credentials),
  signOut: () => {
    forgetSharedRequests();
    return request<void>('POST', '/auth/sign-out');
  },
  createProfile: (credentials: ProfileCredentials) => request<ProfileResponse>('POST', '/profiles', credentials),
  changePassword: (body: ChangePasswordRequest) => request<void>('PUT', '/profiles/me/password', body),
  deleteProfile: (body: DeleteProfileRequest) => request<DeleteProfileResult>('POST', '/profiles/me/delete', body),

  settings: () => request<Settings>('GET', '/settings'),
  setConsoleAddress: (ps5Ip: string) => request<Settings>('PUT', '/settings/connection', { ps5Ip }),
  checkReception: () => request<ReceptionCheck>('POST', '/settings/connection/check'),
  setGameVersion: (version: string) => request<Settings>('PUT', '/settings/game-version', { version }),
  storage: () => request<StorageUse>('GET', '/storage'),
  cleanup: () => request<CleanupResult>('POST', '/storage/cleanup'),

  catalogue: () => request<CatalogueListEntry[]>('GET', '/catalogue'),
  catalogueInfo: () => request<CatalogueInfo>('GET', '/catalogue/info'),
  checkCatalogue: () => request<CatalogueCheckResponse>('POST', '/catalogue/update/check'),
  applyCatalogue: (token: string) => request<{ ok: true }>('POST', '/catalogue/update/apply', { token }),
  restoreCatalogue: () => request<{ ok: true }>('POST', '/catalogue/update/restore'),
  carName: (carId: number) => request<{ id: number; name: string }>('GET', `/cars/${carId}`),

  exercises: () => request<Exercise[]>('GET', '/exercises'),
  exercise: (id: string) => request<Exercise>('GET', `/exercises/${id}`),
  createExercise: (body: CreateExerciseRequest) => request<Exercise>('POST', '/exercises', body),
  updateExercise: (id: string, body: UpdateExerciseRequest) => request<Exercise>('PATCH', `/exercises/${id}`, body),

  captures: () => request<CaptureInfo[]>('GET', '/captures'),
  startCapture: (body: CreateCaptureRequest) => request<CaptureInfo>('POST', '/captures', body),
  stopCapture: (id: string) => request<CaptureInfo>('POST', `/captures/${id}/stop`),

  proposeReference: (exerciseId: string, captureIds: string[]) =>
    request<ReferenceProposal[]>('POST', `/exercises/${exerciseId}/reference-proposals`, { captureIds }),
  references: (exerciseId: string) => request<ReferenceInfo[]>('GET', `/exercises/${exerciseId}/references`),
  createReference: (body: CreateReferenceRequest) => request<ReferenceInfo>('POST', '/references', body),
  activateReference: (id: string) => request<ReferenceInfo>('POST', `/references/${id}/activate`),
  deleteReference: (id: string) => request<{ ok: true }>('DELETE', `/references/${id}`),
  checkReference: (id: string, captureId: string) => request<ReferenceCheckResult>('POST', `/references/${id}/check`, { captureId }),
  referenceTrace: (id: string) => sharedRequest<ReferenceTrace>(`/references/${id}/path`, true),
  referenceCues: (id: string) => sharedRequest<ReferenceCue[]>(`/references/${id}/cues`, false),
  referenceCorners: (id: string) => sharedRequest<CornerInfo[]>(`/references/${id}/corners`, true),
  referenceClips: (id: string) => sharedRequest<string[]>(`/references/${id}/clips`, true),
  reactions: (exerciseId: string) => request<BrakeReactionSummary[]>('GET', `/exercises/${exerciseId}/reactions`),
  promoteAttempt: (id: string) => request<ReferenceInfo>('POST', `/attempts/${id}/promote`),

  arm: (body: ArmTrainingRequest) => request<ArmResponse>('POST', '/training/arm', body),
  disarm: () => request<unknown>('POST', '/training/disarm'),

  attempts: (exerciseId: string) => request<AttemptList>('GET', `/exercises/${exerciseId}/attempts`),
  attempt: (id: string) => request<AttemptSummary>('GET', `/attempts/${id}`),
  review: (id: string, referenceId?: string) => request<AttemptReview>('GET', `/attempts/${id}/review${query({ referenceId })}`),
  recurring: (exerciseId: string, last = RECURRING_DEFAULT_LAST) => request<RecurringDifference[]>('GET', `/exercises/${exerciseId}/recurring${query({ last })}`),
  deleteAttempts: (ids: string[]) => request<DeleteAttemptsResult>('POST', '/attempts/delete', { ids }),
  deleteHistory: (body: DeleteHistoryRequest) => request<DeleteHistoryResult>('POST', '/history/delete', body),
  removeExercises: (body: RemoveExercisesRequest) => request<RemoveExercisesResult>('POST', '/exercises/remove', body),
  progress: () => request<Progress>('GET', '/progress')
};
