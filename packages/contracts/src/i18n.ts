import enMessages from '../locales/en/messages.json' with { type: 'json' };
import enVoice from '../locales/en/voice.json' with { type: 'json' };

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
export type SourceEntry = { text: string; note: string; maxChars?: number };
export type SourceCatalog = Record<string, SourceEntry>;
export type PackCatalog = Record<string, string>;
export type LanguagePack = { lang: string; messages: PackCatalog; voice: PackCatalog };
export type Params = Record<string, string | number>;

type WithoutPlural<K extends string> = K extends `${infer Base}_${PluralCategory}` ? Base : K;
export type MessageKey = WithoutPlural<Extract<keyof typeof enMessages, string>>;

export type PackProblem = { key: string; kind: 'missing' | 'extra' | 'placeholders' | 'plural-form' | 'too-long'; detail: string };

const PLURAL_CATEGORIES: readonly PluralCategory[] = ['zero', 'one', 'two', 'few', 'many', 'other'];
const PLACEHOLDER = /\{([A-Za-z0-9]+)\}/g;

export const PSEUDO_LANG = 'xx';

export const textsOf = (source: SourceCatalog): PackCatalog => Object.fromEntries(Object.entries(source).map(([name, entry]) => [name, entry.text]));

export const ENGLISH_SOURCE: { messages: SourceCatalog; voice: SourceCatalog } = {
  messages: enMessages as SourceCatalog,
  voice: enVoice as SourceCatalog
};

export const ENGLISH: LanguagePack = { lang: 'en', messages: textsOf(ENGLISH_SOURCE.messages), voice: textsOf(ENGLISH_SOURCE.voice) };

const pluralRules = new Map<string, Intl.PluralRules>();

function rulesOf(lang: string): Intl.PluralRules {
  const known = pluralRules.get(lang);
  if (known) return known;
  let rules: Intl.PluralRules;
  try {
    rules = new Intl.PluralRules(Intl.PluralRules.supportedLocalesOf(lang).length > 0 ? lang : 'en');
  } catch {
    rules = new Intl.PluralRules('en');
  }
  pluralRules.set(lang, rules);
  return rules;
}

function pluralCategoriesOf(lang: string): PluralCategory[] {
  return rulesOf(lang).resolvedOptions().pluralCategories as PluralCategory[];
}

function fill(text: string, params: Params | undefined): string {
  if (!params) return text;
  return text.replace(PLACEHOLDER, (whole, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : whole));
}

export function packCatalog(raw: unknown): PackCatalog {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function textAt(catalog: PackCatalog, key: string): string | undefined {
  const text: unknown = catalog[key];
  return typeof text === 'string' && text !== '' ? text : undefined;
}

function lookup(catalog: PackCatalog, lang: string, key: string, params: Params | undefined): string | undefined {
  const count = params?.['count'];
  return typeof count === 'number' ? (textAt(catalog, `${key}_${rulesOf(lang).select(count)}`) ?? textAt(catalog, key)) : (textAt(catalog, key) ?? textAt(catalog, `${key}_other`));
}

function textOf(pack: LanguagePack, part: 'messages' | 'voice', key: string, params: Params | undefined): string {
  const text = lookup(pack[part], pack.lang, key, params) ?? lookup(ENGLISH[part], ENGLISH.lang, key, params) ?? key;
  return fill(text, params);
}

export function translate(pack: LanguagePack, key: MessageKey, params?: Params): string {
  return textOf(pack, 'messages', key, params);
}

export function voiceText(pack: LanguagePack, clip: string, params?: Params): string {
  return textOf(pack, 'voice', `voice.${clip}`, params);
}

function placeholdersOf(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(PLACEHOLDER), match => match[1] ?? ''))].sort();
}

function pluralBase(key: string): string | null {
  const cut = key.lastIndexOf('_');
  if (cut < 0) return null;
  return PLURAL_CATEGORIES.includes(key.slice(cut + 1) as PluralCategory) ? key.slice(0, cut) : null;
}

export function validatePack(source: SourceCatalog, pack: PackCatalog, lang: string): PackProblem[] {
  const problems: PackProblem[] = [];
  const categories = pluralCategoriesOf(lang);
  const expected = new Map<string, SourceEntry>();
  const plurals = new Map<string, SourceEntry>();
  for (const [key, entry] of Object.entries(source)) {
    const base = pluralBase(key);
    if (base === null) expected.set(key, entry);
    else if (key.endsWith('_other') || !plurals.has(base)) plurals.set(base, entry);
  }
  const present = (key: string) => textAt(pack, key) !== undefined;
  for (const [base, entry] of plurals) {
    const forms = categories.map(category => `${base}_${category}`);
    if (!forms.some(present)) {
      problems.push({ key: base, kind: 'missing', detail: `no plural form of "${entry.text}"` });
      continue;
    }
    for (const form of forms) {
      if (present(form)) expected.set(form, entry);
      else problems.push({ key: form, kind: 'plural-form', detail: `the plural form ${form.slice(base.length + 1)} is missing` });
    }
  }
  for (const [key, entry] of expected) {
    const text = textAt(pack, key);
    if (text === undefined) {
      problems.push({ key, kind: 'missing', detail: `no text for "${entry.text}"` });
      continue;
    }
    const found = placeholdersOf(text);
    const countOptional = pluralBase(key) !== null && !key.endsWith('_other');
    const wanted = placeholdersOf(entry.text).filter(name => !(countOptional && name === 'count' && !found.includes(name)));
    if (wanted.join(' ') !== found.join(' ')) {
      problems.push({ key, kind: 'placeholders', detail: `placeholders [${found.join(', ')}], expected [${wanted.join(', ')}]` });
    }
    if (entry.maxChars !== undefined && text.length > entry.maxChars) {
      problems.push({ key, kind: 'too-long', detail: `${text.length} characters, at most ${entry.maxChars}` });
    }
  }
  const allowed = new Set([...Object.keys(source).filter(key => pluralBase(key) === null), ...[...plurals.keys()].flatMap(base => categories.map(category => `${base}_${category}`))]);
  for (const key of Object.keys(pack)) {
    if (!allowed.has(key)) problems.push({ key, kind: 'extra', detail: 'the English source has no such key' });
  }
  return problems;
}

export function packTemplate(source: SourceCatalog, lang: string): PackCatalog {
  const categories = pluralCategoriesOf(lang);
  const keys = new Set<string>();
  for (const key of Object.keys(source)) {
    const base = pluralBase(key);
    if (base === null) keys.add(key);
    else for (const category of categories) keys.add(`${base}_${category}`);
  }
  return Object.fromEntries([...keys].sort().map(key => [key, '']));
}

const ACCENTS: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' };

function pseudoText(text: string): string {
  const parts = text.split(/(\{[A-Za-z0-9]+\})/);
  const body = parts.map((part, index) => (index % 2 === 1 ? part : part.replace(/[aeiouAEIOU]/g, letter => ACCENTS[letter] ?? letter))).join('');
  const padding = Math.max(0, Math.ceil(text.length * 1.4) - text.length - 2);
  const dots = '·'.repeat(padding).replace(/·{10}(?=·)/g, '$&\u200B');
  return `[${body}${dots}]`;
}

const pseudoCatalog = (catalog: PackCatalog): PackCatalog => Object.fromEntries(Object.entries(catalog).map(([key, text]) => [key, pseudoText(text)]));

export function pseudoPack(): LanguagePack {
  return { lang: PSEUDO_LANG, messages: pseudoCatalog(ENGLISH.messages), voice: pseudoCatalog(ENGLISH.voice) };
}
