import { findingKindSchema, type FindingKindName } from './domain.ts';
import { voiceText, type LanguagePack } from './i18n.ts';

export const MAX_SPOKEN_TURN = 10;

const FOCUS_CLIP = /^focus-([a-z-]+)-(\d+)$/;

export function turnText(pack: LanguagePack, turn: number): string {
  return turn <= MAX_SPOKEN_TURN ? voiceText(pack, `turn-${turn}`) : voiceText(pack, 'turn', { turn });
}

export function focusText(pack: LanguagePack, kind: FindingKindName, turn: number): string {
  return voiceText(pack, 'focus', { turn: turnText(pack, turn), action: voiceText(pack, `focus-action.${kind}`) });
}

export function spokenText(pack: LanguagePack, clip: string): string {
  const focus = FOCUS_CLIP.exec(clip);
  if (!focus) return voiceText(pack, clip);
  const kind = findingKindSchema.safeParse(focus[1]);
  if (kind.success) return focusText(pack, kind.data, Number(focus[2]));
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
