import {
  ENGLISH,
  packCatalog,
  PSEUDO_LANG,
  focusText as packFocusText,
  phraseText as packPhraseText,
  pseudoPack,
  spokenText,
  translate,
  type FindingKindName,
  type LanguagePack,
  type MessageKey,
  type Params
} from '@gt7/contracts';

const LANGUAGE_KEY = 'gt7.language';
const FORMAT_LOCALES: Record<string, string> = { en: 'en-GB', [PSEUDO_LANG]: 'en-GB' };

const messageFiles = import.meta.glob<unknown>('../../../../packages/contracts/locales/*/messages.json', { eager: true, import: 'default' });
const voiceFiles = import.meta.glob<unknown>('../../../../packages/contracts/locales/*/voice.json', { eager: true, import: 'default' });

function languageOf(path: string): string {
  return path.split('/').at(-2) ?? '';
}

function contributedPacks(): Map<string, LanguagePack> {
  const voices = new Map(Object.entries(voiceFiles).map(([path, voice]) => [languageOf(path), packCatalog(voice)]));
  return new Map(
    Object.entries(messageFiles)
      .map(([path, messages]) => ({ lang: languageOf(path), messages }))
      .filter(({ lang }) => lang !== ENGLISH.lang && lang !== PSEUDO_LANG)
      .map(({ lang, messages }) => [lang, { lang, messages: packCatalog(messages), voice: voices.get(lang) ?? {} }])
  );
}

function packFor(code: string): LanguagePack {
  if (code === PSEUDO_LANG) return pseudoPack();
  if (code === ENGLISH.lang) return ENGLISH;
  return contributedPacks().get(code) ?? ENGLISH;
}

function storedCode(storage: Storage | null): string | null {
  try {
    return storage?.getItem(LANGUAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

let pack: LanguagePack = ENGLISH;

export function startLanguage(search: string, storage: Storage | null): void {
  const code = new URLSearchParams(search).get('lang') ?? storedCode(storage) ?? ENGLISH.lang;
  pack = packFor(code);
  if (typeof document !== 'undefined') document.documentElement.lang = pack.lang;
}

export function currentLanguage(): string {
  return pack.lang;
}

export function formatLocale(): string {
  return FORMAT_LOCALES[pack.lang] ?? pack.lang;
}

export function t(key: MessageKey, params?: Params): string {
  return translate(pack, key, params);
}

const listFormats = new Map<string, Intl.ListFormat>();

export function listText(items: readonly string[], type: 'conjunction' | 'unit'): string {
  const name = `${formatLocale()} ${type}`;
  let format = listFormats.get(name);
  if (!format) {
    format = new Intl.ListFormat(formatLocale(), { type, style: type === 'unit' ? 'short' : 'long' });
    listFormats.set(name, format);
  }
  return format.format(items);
}

export function phraseText(clips: readonly string[]): string {
  return packPhraseText(pack, clips);
}

export function clipText(clip: string): string {
  return spokenText(pack, clip);
}

export function focusText(kind: FindingKindName, turn: number): string {
  return packFocusText(pack, kind, turn);
}

export function cuePhrase(cue: { phraseClips: readonly string[] | null }): string | null {
  return cue.phraseClips === null ? null : phraseText(cue.phraseClips);
}
