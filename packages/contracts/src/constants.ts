export const CUE_OFFSET_MIN_MS = -500;
export const CUE_OFFSET_MAX_MS = 1000;
export const CUE_OFFSET_STEP_MS = 100;
export const BASELINE_ATTEMPTS = 3;
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
  'busy',
  'car-mismatch',
  'capture-active',
  'console-address-missing',
  'demo-mode',
  'no-game-time',
  'no-previous',
  'no-reference',
  'no-timer-run',
  'not-active',
  'not-armed',
  'reference-active',
  'reference-in-use',
  'rejected',
  'shutting-down',
  'source-failed',
  'stale-check',
  'unknown-token',
  'update-failed',
  'voice-not-ready',
  'wrong-password'
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
