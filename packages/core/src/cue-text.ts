import { findingKindSchema, MAX_SPOKEN_TURN, spokenText, type FindingKindName, type LanguagePack, type WordedCueKind } from '@gt7/contracts';
import { DEFAULT_CONFIG } from './config.ts';
import type { Corner } from './corners.ts';
import type { ReferenceCueEvent } from './cue-events.ts';

export type ClipKind = WordedCueKind | 'voice-check';

export const MIN_TARGET_KPH = 30;
export const MAX_TARGET_KPH = 350;

export const SUPPORTED_TARGETS_KPH: readonly number[] = Array.from(
  { length: (MAX_TARGET_KPH - MIN_TARGET_KPH) / DEFAULT_CONFIG.target.roundDownKph + 1 },
  (_, index) => MIN_TARGET_KPH + index * DEFAULT_CONFIG.target.roundDownKph
);

const CLIP_KINDS: readonly ClipKind[] = [
  'hard-brake',
  'brake',
  'light-brake',
  'ease-off',
  'throttle',
  'full-throttle',
  'keep-left',
  'keep-right',
  'tighter',
  'big-stop',
  'guidance-paused',
  'guidance-resumed',
  'voice-check'
];

const FOCUS_KINDS: readonly FindingKindName[] = findingKindSchema.options;

export function isSupportedTarget(kph: number): boolean {
  return SUPPORTED_TARGETS_KPH.includes(kph);
}

export function clipKey(kind: ClipKind): string {
  return kind;
}

function assertSupportedTarget(kph: number): void {
  if (!isSupportedTarget(kph)) throw new RangeError(`${kph} km/h is not a supported target`);
}

export function speedClipKey(kph: number): string {
  assertSupportedTarget(kph);
  return `speed-${kph}`;
}

function assertTurn(turn: number): void {
  if (!Number.isInteger(turn) || turn < 1) throw new RangeError(`${turn} is not a turn number`);
}

export function focusClipKey(kind: FindingKindName, turn: number): string | null {
  assertTurn(turn);
  return turn <= MAX_SPOKEN_TURN ? `focus-${kind}-${turn}` : null;
}

const SPOKEN_TURNS = Array.from({ length: MAX_SPOKEN_TURN }, (_, index) => index + 1);

export function allClipKeys(): string[] {
  const fixed = CLIP_KINDS.map(clipKey);
  const focus = FOCUS_KINDS.flatMap(kind => SPOKEN_TURNS.map(turn => focusClipKey(kind, turn)!));
  const speeds = SUPPORTED_TARGETS_KPH.map(speedClipKey);
  return [...fixed, ...focus, ...speeds];
}

const ALWAYS_LOADED: readonly ClipKind[] = ['keep-left', 'keep-right', 'guidance-paused', 'guidance-resumed', 'voice-check'];

export function targetClip(event: Pick<ReferenceCueEvent, 'kind' | 'targetSpeedKph'>): string | null {
  return event.kind === 'brake' && event.targetSpeedKph !== null ? speedClipKey(event.targetSpeedKph) : null;
}

export function eventClips(event: Pick<ReferenceCueEvent, 'kind' | 'voice' | 'targetSpeedKph'>, speakTargets: boolean): string[] {
  const target = speakTargets ? targetClip(event) : null;
  return target === null ? [clipKey(event.voice)] : [clipKey(event.voice), target];
}

export function clipsOf(events: ReferenceCueEvent[], corners: Corner[]): string[] {
  const actions = events.flatMap(event => [clipKey(event.voice), targetClip(event)].filter(clip => clip !== null));
  const bigStop = events.some(event => event.bigStop) ? [clipKey('big-stop')] : [];
  const tighter = corners.length > 0 ? [clipKey('tighter')] : [];
  const focus = FOCUS_KINDS.flatMap(kind => corners.map(corner => focusClipKey(kind, corner.number)).filter(clip => clip !== null));
  return [...new Set([...actions, ...bigStop, ...tighter, ...ALWAYS_LOADED.map(clipKey), ...focus])];
}

const PHRASE_BASE_MS = 200;
const MS_PER_WORD = 220;

const KNOWN_CLIPS = new Set(allClipKeys());

export function clipText(pack: LanguagePack, clip: string): string {
  if (!KNOWN_CLIPS.has(clip)) throw new RangeError(`unknown clip ${clip}`);
  return spokenText(pack, clip);
}

export function estimatedPhraseMs(pack: LanguagePack, clip: string): number {
  return PHRASE_BASE_MS + MS_PER_WORD * clipText(pack, clip).split(' ').length;
}
