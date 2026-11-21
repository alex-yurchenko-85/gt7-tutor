import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGLISH, packCatalog, packTemplate, PSEUDO_LANG, textsOf, validatePack, type PackProblem, type SourceCatalog } from '@gt7/contracts';

const LOCALES = join(import.meta.dirname, '../packages/contracts/locales');
const SOURCE_LANG = ENGLISH.lang;
const FILES = ['messages.json', 'voice.json'] as const;
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$/;
const USAGE = 'Usage: pnpm locale:check <language code> | pnpm locale:new <language code>';

type Print = (line: string) => void;
type Read = { ok: true; value: unknown } | { ok: false; problem: string };

function readJson(path: string): Read {
  if (!existsSync(path)) return { ok: false, problem: 'the file is missing' };
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return { ok: false, problem: 'the file is not valid JSON' };
  }
}

function sourceOf(root: string, file: string): SourceCatalog {
  return JSON.parse(readFileSync(join(root, SOURCE_LANG, file), 'utf8')) as SourceCatalog;
}

function badCode(lang: string): string | null {
  if (lang === PSEUDO_LANG) return `${PSEUDO_LANG} is the pseudo-language of GT7 Tutor. Use a different language code.`;
  return LANGUAGE_TAG.test(lang) ? null : `"${lang}" is not a language code. Use a code such as ru, de or pt-BR.`;
}

function check(root: string, lang: string, print: Print): number {
  if (!existsSync(join(root, lang))) {
    print(`The folder ${lang} does not exist. Make it with pnpm locale:new ${lang}.`);
    return 1;
  }
  const lines: string[] = [];
  for (const file of FILES) {
    const source = sourceOf(root, file);
    const read = readJson(join(root, lang, file));
    if (!read.ok) {
      lines.push(`${file}: ${read.problem}`);
      continue;
    }
    const pack = lang === SOURCE_LANG ? textsOf(read.value as SourceCatalog) : packCatalog(read.value);
    const problems: PackProblem[] = validatePack(source, pack, lang);
    lines.push(...problems.map(problem => `${file} ${problem.key} ${problem.kind}: ${problem.detail}`));
  }
  for (const line of lines) print(line);
  print(lines.length === 1 ? '1 problem' : `${lines.length} problems`);
  return lines.length === 0 ? 0 : 1;
}

function create(root: string, lang: string, print: Print): number {
  const folder = join(root, lang);
  if (existsSync(folder)) {
    print(`The folder ${lang} exists already. Choose a different language code or edit the files in it.`);
    return 1;
  }
  const templates = FILES.map(file => ({ file, text: `${JSON.stringify(packTemplate(sourceOf(root, file), lang), null, 2)}\n` }));
  mkdirSync(folder);
  for (const { file, text } of templates) writeFileSync(join(folder, file), text);
  print(`Wrote ${lang}/messages.json and ${lang}/voice.json. Fill in each empty text, then run pnpm locale:check ${lang}.`);
  return 0;
}

export function runLocale(args: string[], root: string, print: Print): number {
  const [command, lang] = args;
  if ((command !== 'check' && command !== 'new') || lang === undefined) {
    print(USAGE);
    return 1;
  }
  const problem = badCode(lang);
  if (problem) {
    print(problem);
    return 1;
  }
  return command === 'check' ? check(root, lang, print) : create(root, lang, print);
}

if (import.meta.main) process.exitCode = runLocale(process.argv.slice(2), LOCALES, line => console.log(line));
