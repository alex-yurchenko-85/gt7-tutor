import type { FindingKindName, FocusPart } from './domain.ts';
import { voiceText, type LanguagePack } from './i18n.ts';

export const MAX_SPOKEN_TURN = 10;

const FOCUS_CLIP = /^focus-([a-z-]+)-(\d+)$/;

export function turnText(pack: LanguagePack, turn: number): string {
  return turn <= MAX_SPOKEN_TURN ? voiceText(pack, `turn-${turn}`) : voiceText(pack, 'turn', { turn });
}

export const FOCUS_PHRASES = [
  'approach-brake-early',
  'approach-brake-late',
  'approach-off-line',
  'approach',
  'entry-slow',
  'entry-fast',
  'entry-wide-apex',
  'entry-off-line',
  'entry',
  'exit-throttle-late',
  'exit-off-line',
  'exit'
] as const;

export type FocusPhrase = (typeof FOCUS_PHRASES)[number];

const CAUSE_PHRASES: Record<FocusPart, Partial<Record<FindingKindName, FocusPhrase>>> = {
  approach: { 'brake-early': 'approach-brake-early', 'brake-late': 'approach-brake-late', 'off-line': 'approach-off-line' },
  entry: { 'brake-late': 'approach-brake-late', 'low-point-early': 'entry-slow', 'slow-corner': 'entry-slow', 'low-point-late': 'entry-fast', 'wide-apex': 'entry-wide-apex', 'off-line': 'entry-off-line' },
  exit: { 'brake-late': 'approach-brake-late', 'throttle-late': 'exit-throttle-late', 'off-line': 'exit-off-line' }
};

export function focusPhrase(part: FocusPart, cause: FindingKindName | null): FocusPhrase {
  return (cause === null ? undefined : CAUSE_PHRASES[part][cause]) ?? part;
}

function isFocusPhrase(text: string): text is FocusPhrase {
  return (FOCUS_PHRASES as readonly string[]).includes(text);
}

export function focusText(pack: LanguagePack, phrase: FocusPhrase, turn: number): string {
  return voiceText(pack, 'focus', { turn: turnText(pack, turn), problem: voiceText(pack, `focus-problem.${phrase}`) });
}

export function spokenText(pack: LanguagePack, clip: string): string {
  const focus = FOCUS_CLIP.exec(clip);
  if (focus && isFocusPhrase(focus[1]!)) return focusText(pack, focus[1], Number(focus[2]));
  return voiceText(pack, clip);
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function phraseText(pack: LanguagePack, clips: readonly string[]): string {
  const [action, speed] = clips;
  if (action === undefined) return '';
  if (speed === undefined) return spokenText(pack, action);
  return voiceText(pack, 'brake-with-target', { action: spokenText(pack, action), speed: capitalized(spokenText(pack, speed)) });
}
