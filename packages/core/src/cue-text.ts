import { CUE_WORDS, type FindingKindName, type WordedCueKind } from '@gt7/contracts';
import { DEFAULT_CONFIG } from './config.ts';
import type { Corner } from './corners.ts';
import type { ReferenceCueEvent } from './cue-events.ts';

export type CountdownKind = 'countdown-three' | 'countdown-two' | 'countdown-one' | 'countdown-start';

export type ClipKind = WordedCueKind | 'voice-check' | CountdownKind;

export const MIN_TARGET_KPH = 30;
export const MAX_TARGET_KPH = 350;
export const MAX_SPOKEN_TURN = 10;

export const SUPPORTED_TARGETS_KPH: readonly number[] = Array.from(
  { length: (MAX_TARGET_KPH - MIN_TARGET_KPH) / DEFAULT_CONFIG.target.roundDownKph + 1 },
  (_, index) => MIN_TARGET_KPH + index * DEFAULT_CONFIG.target.roundDownKph
);

const PHRASES: Record<ClipKind, string> = {
  ...CUE_WORDS,
  'voice-check': 'Voice check',
  'countdown-three': 'Three',
  'countdown-two': 'Two',
  'countdown-one': 'One',
  'countdown-start': 'Start'
};

const COUNTDOWN_KINDS: readonly CountdownKind[] = ['countdown-three', 'countdown-two', 'countdown-one', 'countdown-start'];

const FOCUS_ACTIONS: Record<FindingKindName, string> = {
  'brake-early': 'Brake later.',
  'brake-late': 'Brake earlier.',
  'slow-corner': 'Carry more speed.',
  'throttle-late': 'Throttle earlier.',
  'off-line': 'Stay on the line.',
  'wide-apex': 'Tighter at the apex.'
};

const UNITS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function belowHundred(value: number): string {
  if (value < 10) return UNITS[value]!;
  if (value < 20) return TEENS[value - 10]!;
  const units = value % 10;
  const tens = TENS[Math.floor(value / 10)]!;
  return units === 0 ? tens : `${tens} ${UNITS[units]}`;
}

export function speedWords(kph: number): string {
  if (!Number.isInteger(kph) || kph < 1 || kph > MAX_TARGET_KPH) throw new RangeError(`no words for ${kph} km/h`);
  if (kph < 100) return belowHundred(kph);
  const hundreds = UNITS[Math.floor(kph / 100)]!;
  const rest = kph % 100;
  if (rest === 0) return `${hundreds} hundred`;
  if (rest < 10) return `${hundreds} oh ${UNITS[rest]}`;
  return `${hundreds} ${belowHundred(rest)}`;
}

export function isSupportedTarget(kph: number): boolean {
  return SUPPORTED_TARGETS_KPH.includes(kph);
}

export function clipKey(kind: ClipKind): string {
  return kind;
}

export const COUNTDOWN_CLIPS: string[] = COUNTDOWN_KINDS.map(clipKey);

export function cueText(kind: ClipKind): string {
  return PHRASES[kind];
}

function assertSupportedTarget(kph: number): void {
  if (!isSupportedTarget(kph)) throw new RangeError(`${kph} km/h is not a supported target`);
}

export function speedClipKey(kph: number): string {
  assertSupportedTarget(kph);
  return `speed-${kph}`;
}

function turnWords(turn: number): string {
  return turn <= MAX_SPOKEN_TURN ? speedWords(turn) : String(turn);
}

function assertTurn(turn: number): void {
  if (!Number.isInteger(turn) || turn < 1) throw new RangeError(`${turn} is not a turn number`);
}

export function focusText(kind: FindingKindName, turn: number): string {
  assertTurn(turn);
  return `Turn ${turnWords(turn)}. ${FOCUS_ACTIONS[kind]}`;
}

export function focusClipKey(kind: FindingKindName, turn: number): string | null {
  assertTurn(turn);
  return turn <= MAX_SPOKEN_TURN ? `focus-${kind}-${turn}` : null;
}

const FOCUS_KINDS = Object.keys(FOCUS_ACTIONS) as FindingKindName[];
const SPOKEN_TURNS = Array.from({ length: MAX_SPOKEN_TURN }, (_, index) => index + 1);

export function allClipKeys(): string[] {
  const fixed = (Object.keys(PHRASES) as ClipKind[]).map(clipKey);
  const focus = FOCUS_KINDS.flatMap(kind => SPOKEN_TURNS.map(turn => focusClipKey(kind, turn)!));
  const speeds = SUPPORTED_TARGETS_KPH.map(speedClipKey);
  return [...fixed, ...focus, ...speeds];
}

const ALWAYS_LOADED: readonly ClipKind[] = ['keep-left', 'keep-right', 'guidance-paused', 'guidance-resumed', 'voice-check'];

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function targetClip(event: Pick<ReferenceCueEvent, 'kind' | 'targetSpeedKph'>): string | null {
  return event.kind === 'brake' && event.targetSpeedKph !== null ? speedClipKey(event.targetSpeedKph) : null;
}

export function eventPhrase(event: Pick<ReferenceCueEvent, 'kind' | 'voice' | 'targetSpeedKph'>, speakTargets: boolean): string {
  const action = cueText(event.voice);
  if (!speakTargets || event.kind !== 'brake' || event.targetSpeedKph === null) return action;
  return `${action}. ${capitalized(speedWords(event.targetSpeedKph))}`;
}

export function clipsOf(events: ReferenceCueEvent[], corners: Corner[]): string[] {
  const actions = events.flatMap(event => [clipKey(event.voice), targetClip(event)].filter(clip => clip !== null));
  const bigStop = events.some(event => event.bigStop) ? [clipKey('big-stop')] : [];
  const tighter = corners.length > 0 ? [clipKey('tighter')] : [];
  const focus = FOCUS_KINDS.flatMap(kind => corners.map(corner => focusClipKey(kind, corner.number)).filter(clip => clip !== null));
  return [...new Set([...actions, ...bigStop, ...tighter, ...ALWAYS_LOADED.map(clipKey), ...focus, ...COUNTDOWN_CLIPS])];
}

const PHRASE_BASE_MS = 200;
const MS_PER_WORD = 220;

export function clipText(clip: string): string {
  const speed = /^speed-(\d+)$/.exec(clip);
  if (speed) {
    const kph = Number(speed[1]);
    assertSupportedTarget(kph);
    return speedWords(kph);
  }
  const focus = /^focus-([a-z-]+)-(\d+)$/.exec(clip);
  if (focus && focus[1]! in FOCUS_ACTIONS) return focusText(focus[1] as FindingKindName, Number(focus[2]));
  if (clip in PHRASES) return cueText(clip as ClipKind);
  throw new RangeError(`unknown clip ${clip}`);
}

export function estimatedPhraseMs(clip: string): number {
  return PHRASE_BASE_MS + MS_PER_WORD * clipText(clip).split(' ').length;
}
