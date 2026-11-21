import type { MessageKey } from '@gt7/contracts';
import { formatLocale, t } from './i18n.ts';

const GAME_TIME_DIGITS = 3;

const ABORT_REASONS: Record<string, MessageKey> = {
  'left-track': 'app.abort.left-track',
  restart: 'app.abort.restart',
  manual: 'app.abort.manual',
  silence: 'app.abort.silence',
  'player-session-ended': 'app.abort.player-session-ended',
  loading: 'app.abort.loading',
  'car-changed': 'app.abort.car-changed',
  discontinuity: 'app.abort.discontinuity'
};

export function formatTime(ms: number | null, digits = GAME_TIME_DIGITS): string {
  if (ms === null) return t('app.time.none');
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
  const key = ABORT_REASONS[reason];
  return key ? t(key) : reason;
}

export function formatSeconds(ms: number): string {
  return t('app.unit.seconds', { value: (ms / 1000).toFixed(2) });
}

export function signedSeconds(ms: number, digits = 2): string {
  const text = (Math.abs(ms) / 1000).toFixed(digits);
  if (Number(text) === 0) return text;
  return `${ms > 0 ? '+' : '\u2212'}${text}`;
}

export function signedSecondsText(ms: number, digits = 2): string {
  return t('app.unit.seconds', { value: signedSeconds(ms, digits) });
}

export function formatGap(ms: number | null): string {
  if (ms === null) return '';
  if (ms === 0) return t('app.gap.best');
  return signedSecondsText(ms);
}

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

export function formatDateTime(iso: string): string {
  const locale = formatLocale();
  let format = dateTimeFormats.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    dateTimeFormats.set(locale, format);
  }
  return format.format(new Date(iso));
}

export function formatDay(iso: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return date.toLocaleDateString(formatLocale(), { day: 'numeric', month: 'long' });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatHourMinute(iso: string): string {
  return new Date(iso).toLocaleTimeString(formatLocale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

export function localDay(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatClock(at: Date): string {
  return at.toLocaleTimeString(formatLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function groupedMetres(value: number): string {
  return t('app.unit.metres', { value: Math.round(value).toLocaleString(formatLocale()) });
}

export function metres(value: number): string {
  return t('app.unit.metres', { value: Math.round(value) });
}
