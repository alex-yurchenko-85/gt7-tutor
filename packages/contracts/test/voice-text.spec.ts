import { describe, expect, it } from 'vitest';
import { ENGLISH, type LanguagePack } from '../src/i18n.ts';
import { focusText, phraseText, spokenText, turnText } from '../src/voice-text.ts';

describe('voice text', () => {
  it('spoken_text_of_each_clip_kind', () => {
    expect(spokenText(ENGLISH, 'hard-brake')).toBe('Hard brake');
    expect(spokenText(ENGLISH, 'ease-off')).toBe('Lift off');
    expect(spokenText(ENGLISH, 'voice-check')).toBe('Voice check');
    expect(spokenText(ENGLISH, 'speed-85')).toBe('eighty five');
    expect(spokenText(ENGLISH, 'speed-205')).toBe('two oh five');
    expect(spokenText(ENGLISH, 'focus-brake-late-3')).toBe('Turn three. Brake earlier.');
  });

  it('turns_above_ten_are_shown_in_digits', () => {
    expect(turnText(ENGLISH, 10)).toBe('Turn ten');
    expect(turnText(ENGLISH, 11)).toBe('Turn 11');
    expect(focusText(ENGLISH, 'brake-late', 11)).toBe('Turn 11. Brake earlier.');
    expect(focusText(ENGLISH, 'brake-early', 1)).toBe('Turn one. Brake later.');
  });

  it('phrase_text_joins_the_action_and_the_target_speed', () => {
    expect(phraseText(ENGLISH, ['hard-brake', 'speed-115'])).toBe('Hard brake. One fifteen');
    expect(phraseText(ENGLISH, ['full-throttle'])).toBe('Full throttle');
    expect(phraseText(ENGLISH, [])).toBe('');
  });

  it('a_pack_without_a_voice_text_falls_back_to_english', () => {
    const pack: LanguagePack = { lang: 'ru', messages: {}, voice: { 'voice.hard-brake': 'Сильно тормози', 'voice.focus': '{turn}: {action}' } };
    expect(phraseText(pack, ['hard-brake', 'speed-85'])).toBe('Сильно тормози. Eighty five');
    expect(focusText(pack, 'off-line', 2)).toBe('Turn two: Stay on the line.');
  });
});
