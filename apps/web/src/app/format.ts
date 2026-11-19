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
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(digits).padStart(digits + 3, '0')}`;
}

export function abortReasonText(reason: string): string {
  return ABORT_REASONS[reason] ?? reason;
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

export function metres(value: number): string {
  return `${Math.round(value)} m`;
}

const SHORT_NAME_LENGTH = 20;

export function shortName(name: string): string {
  const head = name.split(':')[0]!.trim();
  return head.length > SHORT_NAME_LENGTH ? `${head.slice(0, SHORT_NAME_LENGTH - 1).trimEnd()}…` : head;
}
