const GAME_TIME_DIGITS = 3;

const ABORT_REASONS: Record<string, string> = {
  'left-track': 'left the track',
  restart: 'restarted',
  manual: 'training stopped',
  silence: 'telemetry stopped',
  'player-session-ended': 'left the exercise',
  loading: 'game loading',
  'car-changed': 'car changed',
  discontinuity: 'car position jumped'
};

export function formatTime(ms: number | null, digits = GAME_TIME_DIGITS): string {
  if (ms === null) return 'no time';
  const perSecond = 10 ** digits;
  const units = Math.round((ms / 1000) * perSecond);
  const wholeSeconds = Math.floor(units / perSecond);
  const fraction = digits > 0 ? `.${String(units % perSecond).padStart(digits, '0')}` : '';
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const seconds = String(wholeSeconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}${fraction}` : `${minutes}:${seconds}${fraction}`;
}

export function abortReasonText(reason: string): string {
  return ABORT_REASONS[reason] ?? reason;
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

export function signedSeconds(ms: number, digits = 2): string {
  const text = (Math.abs(ms) / 1000).toFixed(digits);
  if (Number(text) === 0) return text;
  return `${ms > 0 ? '+' : '\u2212'}${text}`;
}

export function formatGap(ms: number | null): string {
  if (ms === null) return '';
  if (ms === 0) return 'best';
  return `${signedSeconds(ms)} s`;
}

const DATE_TIME = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}

export function formatDay(iso: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatHourMinute(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

export function localDay(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatClock(at: Date): string {
  return at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function groupedMetres(value: number): string {
  return `${Math.round(value).toLocaleString('en-GB')} m`;
}

export function metres(value: number): string {
  return `${Math.round(value)} m`;
}
