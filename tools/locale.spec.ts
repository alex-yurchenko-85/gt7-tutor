import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGLISH_SOURCE } from '@gt7/contracts';
import { runLocale } from './locale.ts';
import { testTempDir } from './testing/temp-root.ts';

const LOCALES = join(import.meta.dirname, '../packages/contracts/locales');

function localesCopy(): string {
  const root = testTempDir('locale-');
  cpSync(join(LOCALES, 'en'), join(root, 'en'), { recursive: true });
  return root;
}

function run(root: string, ...args: string[]): { code: number; lines: string[] } {
  const lines: string[] = [];
  const code = runLocale(args, root, line => lines.push(line));
  return { code, lines };
}

function readPack(root: string, lang: string, file: string): Record<string, string> {
  return JSON.parse(readFileSync(join(root, lang, file), 'utf8')) as Record<string, string>;
}

describe('locale tool', () => {
  it('check_finds_no_problem_in_the_english_source', () => {
    const { code, lines } = run(LOCALES, 'check', 'en');
    expect(code).toBe(0);
    expect(lines.at(-1)).toBe('0 problems');
  });

  it('new_writes_the_russian_plural_forms', () => {
    const root = localesCopy();
    const { code } = run(root, 'new', 'ru');
    expect(code).toBe(0);
    const messages = readPack(root, 'ru', 'messages.json');
    expect(Object.keys(messages).filter(key => key.startsWith('races.laps_'))).toEqual(['races.laps_few', 'races.laps_many', 'races.laps_one', 'races.laps_other']);
    expect(messages['common.cancel']).toBe('');
    expect(Object.values(messages).every(text => text === '')).toBe(true);
    const voice = readPack(root, 'ru', 'voice.json');
    expect(Object.keys(voice)).toEqual(Object.keys(ENGLISH_SOURCE.voice).sort());
  });

  it('check_reports_an_empty_value_as_missing', () => {
    const root = localesCopy();
    run(root, 'new', 'de');
    const messages = readPack(root, 'de', 'messages.json');
    const filled = Object.fromEntries(Object.keys(messages).map(key => [key, ENGLISH_SOURCE.messages[key]?.text ?? ENGLISH_SOURCE.messages[key.replace(/_[a-z]+$/, '_other')]!.text]));
    writeFileSync(join(root, 'de', 'messages.json'), JSON.stringify({ ...filled, 'common.cancel': '' }));
    const voice = readPack(root, 'de', 'voice.json');
    writeFileSync(join(root, 'de', 'voice.json'), JSON.stringify(Object.fromEntries(Object.keys(voice).map(key => [key, ENGLISH_SOURCE.voice[key]!.text]))));
    const { code, lines } = run(root, 'check', 'de');
    expect(code).toBe(1);
    expect(lines).toEqual(['messages.json common.cancel missing: no text for "Cancel"', '1 problem']);
  });

  it('check_reports_a_value_that_is_not_text', () => {
    const root = localesCopy();
    mkdirSync(join(root, 'fr'));
    writeFileSync(join(root, 'fr', 'messages.json'), JSON.stringify({ 'common.cancel': { text: 'Annuler', note: 'Button' } }));
    const { code, lines } = run(root, 'check', 'fr');
    expect(code).toBe(1);
    expect(lines).toContain('messages.json common.cancel missing: no text for "Cancel"');
    expect(lines).toContain('voice.json: the file is missing');
  });

  it('new_refuses_a_code_that_is_not_a_language_tag', () => {
    const root = localesCopy();
    for (const code of ['../ru', 'ru/x', 'RU', 'r', 'english', 'xx', '', 'pt_BR']) {
      const result = run(root, 'new', code);
      expect(result.code).toBe(1);
      expect(result.lines.join(' ')).toContain('language code');
    }
    expect(existsSync(join(root, '..', 'ru'))).toBe(false);
    expect(run(root, 'new', 'pt-BR').code).toBe(0);
    expect(existsSync(join(root, 'pt-BR', 'messages.json'))).toBe(true);
  });

  it('new_refuses_an_existing_folder', () => {
    const root = localesCopy();
    expect(run(root, 'new', 'en')).toEqual({ code: 1, lines: ['The folder en exists already. Choose a different language code or edit the files in it.'] });
  });

  it('check_refuses_an_unknown_language_and_explains_the_commands', () => {
    const root = localesCopy();
    expect(run(root, 'check', 'it')).toEqual({ code: 1, lines: ['The folder it does not exist. Make it with pnpm locale:new it.'] });
    expect(run(root, 'check', '../en').code).toBe(1);
    expect(run(root).lines).toEqual(['Usage: pnpm locale:check <language code> | pnpm locale:new <language code>']);
  });
});
