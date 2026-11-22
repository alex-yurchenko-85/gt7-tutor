import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../src/constants.ts';
import { ENGLISH, ENGLISH_SOURCE, packCatalog, pseudoPack, translate, validatePack, voiceText, type LanguagePack, type MessageKey, type SourceCatalog } from '../src/i18n.ts';

const key = (value: string) => value as MessageKey;

const testPack = (lang: string, messages: Record<string, string>): LanguagePack => ({ lang, messages, voice: {} });

const PLACEHOLDERS = /\{[A-Za-z0-9]+\}/g;

describe('i18n', () => {
  it('formats_placeholders', () => {
    const pack = testPack('en', { 'races.laps-of': '{count} of {total} laps' });
    expect(translate(pack, key('races.laps-of'), { count: 3, total: 7 })).toBe('3 of 7 laps');
  });

  it('picks_the_english_plural', () => {
    const pack = testPack('en', { 'races.laps_one': '{count} lap', 'races.laps_other': '{count} laps' });
    expect(translate(pack, key('races.laps'), { count: 1 })).toBe('1 lap');
    expect(translate(pack, key('races.laps'), { count: 2 })).toBe('2 laps');
    expect(translate(pack, key('races.laps'), { count: 0 })).toBe('0 laps');
    expect(translate(pack, key('races.laps'))).toBe('{count} laps');
  });

  it('picks_the_russian_plural_forms', () => {
    const pack = testPack('ru', { 'races.laps_one': 'one {count}', 'races.laps_few': 'few {count}', 'races.laps_many': 'many {count}', 'races.laps_other': 'other {count}' });
    const forms = [0, 1, 2, 5, 11, 21, 22].map(count => translate(pack, key('races.laps'), { count }));
    expect(forms).toEqual(['many 0', 'one 1', 'few 2', 'many 5', 'many 11', 'one 21', 'few 22']);
  });

  it('falls_back_to_english_for_a_missing_key', () => {
    const pack = testPack('ru', {});
    expect(translate(pack, 'common.cancel')).toBe('Cancel');
    expect(translate(testPack('ru', { 'common.cancel': '' }), 'common.cancel')).toBe('Cancel');
    expect(voiceText({ lang: 'ru', messages: {}, voice: { 'voice.turn': 'Поворот {turn}' } }, 'turn', { turn: 11 })).toBe('Поворот 11');
  });

  it('ignores_a_value_that_is_not_text_key_by_key', () => {
    const loaded = packCatalog({ 'common.cancel': { text: 'Отмена', note: 'Button' }, 'common.close': 'Закрыть', 'common.delete': 7, 'common.breadcrumb': null });
    expect(loaded).toEqual({ 'common.close': 'Закрыть' });
    expect(packCatalog(['Отмена'])).toEqual({});
    expect(packCatalog('Отмена')).toEqual({});
    expect(packCatalog(null)).toEqual({});
    const raw = { lang: 'ru', messages: { 'common.cancel': { text: 'Отмена', note: 'Button' }, 'common.close': 'Закрыть' }, voice: { 'voice.turn': 3 } } as unknown as LanguagePack;
    expect(translate(raw, 'common.cancel')).toBe('Cancel');
    expect(translate(raw, 'common.close')).toBe('Закрыть');
    expect(voiceText(raw, 'turn', { turn: 11 })).toBe('Turn 11');
  });

  it('keeps_braces_in_values_and_unknown_placeholders', () => {
    const pack = testPack('en', { 'app.greeting': 'Hi {name}', 'app.value': 'Value {v} and {w}' });
    expect(translate(pack, key('app.value'), { v: '{x}', w: 'y' })).toBe('Value {x} and y');
    expect(translate(pack, key('app.greeting'))).toBe('Hi {name}');
    expect(translate(pack, key('app.greeting'), { other: 1 })).toBe('Hi {name}');
  });

  it('validates_a_pack', () => {
    const source: SourceCatalog = {
      'common.cancel': { text: 'Cancel', note: 'Button', maxChars: 10 },
      'common.close': { text: 'Close', note: 'Button' },
      'races.laps_one': { text: '{count} lap', note: 'Count' },
      'races.laps_other': { text: '{count} laps', note: 'Count' },
      'races.title': { text: 'Races', note: 'Title' },
      'races.best': { text: 'Best {time}', note: 'Caption' }
    };
    const problems = validatePack(
      source,
      {
        'common.cancel': 'Отменить действие',
        'common.close': '',
        'races.laps_one': '{count} круг',
        'races.laps_many': '{count} кругов',
        'races.laps_other': 'кругов',
        'races.best': 'Лучший {time}',
        'races.unknown': 'x'
      },
      'ru'
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'common.cancel', kind: 'too-long' }),
        expect.objectContaining({ key: 'common.close', kind: 'missing' }),
        expect.objectContaining({ key: 'races.title', kind: 'missing' }),
        expect.objectContaining({ key: 'races.laps_few', kind: 'plural-form' }),
        expect.objectContaining({ key: 'races.laps_other', kind: 'placeholders' }),
        expect.objectContaining({ key: 'races.unknown', kind: 'extra' })
      ])
    );
    expect(problems).toHaveLength(6);
    const pluralSource: SourceCatalog = { 'races.laps_one': { text: 'One lap', note: 'Count' }, 'races.laps_other': { text: '{count} laps', note: 'Count' } };
    expect(validatePack(pluralSource, { 'races.laps_one': '{count} круг', 'races.laps_few': '{count} круга', 'races.laps_many': '{count} кругов', 'races.laps_other': '{count} круга' }, 'ru')).toEqual([]);
    expect(validatePack(pluralSource, { 'races.laps_one': 'Один {lap}', 'races.laps_few': '{count} круга', 'races.laps_many': '{count} кругов', 'races.laps_other': '{count} круга' }, 'ru')).toEqual([
      expect.objectContaining({ key: 'races.laps_one', kind: 'placeholders' })
    ]);
    expect(problems.every(problem => problem.detail.length > 0)).toBe(true);
  });

  it('makes_the_pseudo_language', () => {
    const pseudo = pseudoPack();
    expect(pseudo.lang).toBe('xx');
    for (const [name, english] of Object.entries({ ...ENGLISH.messages, ...ENGLISH.voice })) {
      const text = pseudo.messages[name] ?? pseudo.voice[name] ?? '';
      expect(text.startsWith('[')).toBe(true);
      expect(text.endsWith(']')).toBe(true);
      expect(text.replaceAll('\u200B', '').length).toBeGreaterThanOrEqual(Math.ceil(english.length * 1.4));
      expect(text.match(PLACEHOLDERS) ?? []).toEqual(english.match(PLACEHOLDERS) ?? []);
    }
    expect(translate(pseudo, 'common.cancel')).toBe('[Cáncél·]');
  });

  it('lets_a_long_pseudo_padding_break', () => {
    const pseudo = pseudoPack();
    const text = translate(pseudo, 'races.empty.text-wide');
    expect(text).toContain('\u200B');
    expect(text).not.toMatch(/·{11}/);
    expect(text.split('\u200B').every(part => part.length > 0)).toBe(true);
    expect(translate(ENGLISH, 'races.empty.text-wide')).not.toContain('\u200B');
  });

  it('english_source_is_valid', () => {
    expect(validatePack(ENGLISH_SOURCE.messages, ENGLISH.messages, 'en')).toEqual([]);
    expect(validatePack(ENGLISH_SOURCE.voice, ENGLISH.voice, 'en')).toEqual([]);
    expect(Object.keys(ENGLISH_SOURCE.voice).every(name => name.startsWith('voice.'))).toBe(true);
    expect(Object.keys(ENGLISH_SOURCE.messages).some(name => name.startsWith('voice.'))).toBe(false);
    for (const entry of Object.values({ ...ENGLISH_SOURCE.messages, ...ENGLISH_SOURCE.voice })) {
      expect(entry.note.trim()).not.toBe('');
    }
    expect(ENGLISH.messages['common.cancel']).toBe('Cancel');
  });

  it('every_error_code_has_an_english_text', () => {
    const texts = Object.keys(ENGLISH.messages).filter(name => name.startsWith('errors.'));
    expect(texts.sort()).toEqual([...ERROR_CODES.map(code => `errors.${code}`), 'errors.unknown', 'errors.no-connection'].sort());
  });

  it('english_voice_source_is_valid', () => {
    expect(validatePack(ENGLISH_SOURCE.voice, ENGLISH.voice, 'en')).toEqual([]);
    expect(Object.keys(ENGLISH.voice)).toHaveLength(97);
    expect(ENGLISH.voice['voice.speed-85']).toBe('eighty five');
  });
});
