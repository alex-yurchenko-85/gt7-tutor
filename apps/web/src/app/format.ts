const MEASURED_DIGITS = 2;
const OFFICIAL_DIGITS = 3;

export function formatTime(ms: number | null, digits = MEASURED_DIGITS): string {
  if (ms === null) return 'no time';
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(digits).padStart(digits + 3, '0')}`;
}

export function formatOfficialTime(ms: number | null): string {
  return formatTime(ms, OFFICIAL_DIGITS);
}

export function formatAttemptTime(attempt: { officialMs: number | null; timeMs: number | null }): string {
  return attempt.officialMs !== null ? formatOfficialTime(attempt.officialMs) : formatTime(attempt.timeMs);
}

export function formatGap(ms: number | null): string {
  if (ms === null) return '';
  if (ms === 0) return 'best';
  return `${ms > 0 ? '+' : '−'}${(Math.abs(ms) / 1000).toFixed(2)} s`;
}

export function formatDay(iso: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

export function metres(value: number): string {
  return `${Math.round(value)} m`;
}
