import { describe, expect, it } from 'vitest';
import { ENGLISH, type LanguagePack } from '../src/i18n.ts';
import { FOCUS_PHRASES, focusPhrase, focusText, phraseText, spokenText, turnText } from '../src/voice-text.ts';

describe('voice text', () => {
  it('spoken_text_of_each_clip_kind', () => {
    expect(spokenText(ENGLISH, 'hard-brake')).toBe('Hard brake');
    expect(spokenText(ENGLISH, 'ease-off')).toBe('Lift off');
    expect(spokenText(ENGLISH, 'voice-check')).toBe('Voice check');
    expect(spokenText(ENGLISH, 'speed-85')).toBe('eighty five');
    expect(spokenText(ENGLISH, 'speed-205')).toBe('two oh five');
    expect(spokenText(ENGLISH, 'focus-entry-slow-3')).toBe('Turn three. Too slow on entry.');
    expect(spokenText(ENGLISH, 'focus-approach-2')).toBe('Turn two. Time lost before the turn.');
  });

  it('turns_above_ten_are_shown_in_digits', () => {
    expect(turnText(ENGLISH, 10)).toBe('Turn ten');
    expect(turnText(ENGLISH, 11)).toBe('Turn 11');
    expect(focusText(ENGLISH, 'approach-brake-late', 11)).toBe('Turn 11. Braking too late before the turn.');
    expect(focusText(ENGLISH, 'approach-brake-early', 1)).toBe('Turn one. Braking too early before the turn.');
  });

  it('focus_phrase_comes_from_the_part_and_the_cause', () => {
    expect(focusPhrase('approach', 'brake-early')).toBe('approach-brake-early');
    expect(focusPhrase('approach', 'brake-late')).toBe('approach-brake-late');
    expect(focusPhrase('entry', 'low-point-early')).toBe('entry-slow');
    expect(focusPhrase('entry', 'slow-corner')).toBe('entry-slow');
    expect(focusPhrase('entry', 'low-point-late')).toBe('entry-fast');
    expect(focusPhrase('entry', 'wide-apex')).toBe('entry-wide-apex');
    expect(focusPhrase('exit', 'throttle-late')).toBe('exit-throttle-late');
    expect(focusPhrase('approach', 'off-line')).toBe('approach-off-line');
    expect(focusPhrase('entry', 'off-line')).toBe('entry-off-line');
    expect(focusPhrase('exit', 'off-line')).toBe('exit-off-line');
    expect(focusPhrase('entry', 'brake-late')).toBe('approach-brake-late');
    expect(focusPhrase('exit', 'brake-late')).toBe('approach-brake-late');
    expect(focusPhrase('exit', null)).toBe('exit');
    expect(focusPhrase('exit', 'brake-early')).toBe('exit');
    expect(FOCUS_PHRASES).toHaveLength(12);
  });

  it('phrase_text_joins_the_action_and_the_target_speed', () => {
    expect(phraseText(ENGLISH, ['hard-brake', 'speed-115'])).toBe('Hard brake. One fifteen');
    expect(phraseText(ENGLISH, ['full-throttle'])).toBe('Full throttle');
    expect(phraseText(ENGLISH, [])).toBe('');
  });

  it('a_pack_without_a_voice_text_falls_back_to_english', () => {
    const pack: LanguagePack = { lang: 'ru', messages: {}, voice: { 'voice.hard-brake': 'Сильно тормози', 'voice.focus': '{turn}: {problem}' } };
    expect(phraseText(pack, ['hard-brake', 'speed-85'])).toBe('Сильно тормози. Eighty five');
    expect(focusText(pack, 'exit-off-line', 2)).toBe('Turn two: Off the line on exit.');
  });
});
