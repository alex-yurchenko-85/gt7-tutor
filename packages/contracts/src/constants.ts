export const CUE_OFFSET_MIN_MS = -500;
export const CUE_OFFSET_MAX_MS = 1000;
export const CUE_OFFSET_STEP_MS = 100;
export const TARGET_MAX_MS = 3_600_000;
export const WIDE_APEX_M = 2;
export const RECURRING_MIN_ATTEMPTS = 3;
export const RECURRING_DEFAULT_LAST = 8;
export const UNAUTHENTICATED_CLOSE_CODE = 4401;
export const MAX_OUTPUT_LATENCY_MS = 2000;
export const DEFAULT_STATE_RATE = 15;
export const KPH_PER_MPS = 3.6;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export const ERROR_CODES = [
  'attempt-not-found',
  'busy',
  'capture-active',
  'capture-not-found',
  'car-changed',
  'car-mismatch',
  'catalogue-busy',
  'console-address-missing',
  'cross-site',
  'demo-mode',
  'discontinuity',
  'exercise-not-found',
  'invalid-request',
  'no-match',
  'no-previous',
  'no-reference',
  'no-timer-run',
  'nonfinite-field',
  'not-active',
  'not-armed',
  'not-complete',
  'not-found',
  'not-recording',
  'profile-exists',
  'profile-name-taken',
  'race-capture',
  'race-not-found',
  'raw-missing',
  'reference-active',
  'reference-in-training',
  'reference-in-use',
  'reference-not-found',
  'rejected',
  'same-lap',
  'server-error',
  'shutting-down',
  'sign-in-required',
  'source-failed',
  'stale-check',
  'too-few-points',
  'too-many-sign-ins',
  'unknown-lap',
  'unknown-token',
  'update-failed',
  'wrong-name-or-password',
  'wrong-password'
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}
