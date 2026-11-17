import { describe, expect, it } from 'vitest';
import {
  allClipKeys,
  clipKey,
  clipText,
  cueText,
  focusClipKey,
  focusText,
  speedClipKey,
  speedWords,
  SUPPORTED_TARGETS_KPH
} from '../src/cue-text.ts';

describe('cue text', () => {
  it('speed_words', () => {
    expect(speedWords(80)).toBe('eighty');
    expect(speedWords(95)).toBe('ninety five');
    expect(speedWords(100)).toBe('one hundred');
    expect(speedWords(120)).toBe('one twenty');
    expect(speedWords(205)).toBe('two oh five');
    expect(speedWords(30)).toBe('thirty');
    expect(speedWords(115)).toBe('one fifteen');
    expect(speedWords(110)).toBe('one ten');
    expect(speedWords(300)).toBe('three hundred');
    expect(speedWords(350)).toBe('three fifty');
  });

  it('phrases_are_exact', () => {
    expect(cueText('hard-brake')).toBe('Hard brake');
    expect(cueText('brake')).toBe('Brake');
    expect(cueText('light-brake')).toBe('Light brake');
    expect(cueText('ease-off')).toBe('Ease off');
    expect(cueText('throttle')).toBe('Throttle');
    expect(cueText('full-throttle')).toBe('Full throttle');
    expect(cueText('keep-left')).toBe('Keep left');
    expect(cueText('keep-right')).toBe('Keep right');
    expect(cueText('tighter')).toBe('Tighter');
    expect(cueText('big-stop')).toBe('Big stop');
    expect(cueText('guidance-paused')).toBe('Guidance paused');
    expect(cueText('guidance-resumed')).toBe('Guidance resumed');
    expect(cueText('voice-check')).toBe('Voice check');
    expect(clipKey('hard-brake')).toBe('hard-brake');
  });

  it('focus_text_names_the_turn', () => {
    expect(focusText('brake-early', 1)).toBe('Turn one. Brake later.');
    expect(focusText('brake-late', 2)).toBe('Turn two. Brake earlier.');
    expect(focusText('slow-corner', 3)).toBe('Turn three. Carry more speed.');
    expect(focusText('throttle-late', 4)).toBe('Turn four. Throttle earlier.');
    expect(focusText('wide-apex', 10)).toBe('Turn ten. Tighter at the apex.');
    expect(focusText('off-line', 11)).toBe('Turn 11. Stay on the line.');
  });

  it('focus_clip_only_up_to_ten', () => {
    expect(focusClipKey('brake-late', 10)).toBe('focus-brake-late-10');
    expect(focusClipKey('brake-early', 1)).toBe('focus-brake-early-1');
    expect(focusClipKey('brake-late', 11)).toBeNull();
    expect(clipText('focus-wide-apex-1')).toBe('Turn one. Tighter at the apex.');
  });

  it('speed_clips_say_the_number', () => {
    expect(speedClipKey(85)).toBe('speed-85');
    expect(clipText('speed-85')).toBe('eighty five');
    expect(clipText('speed-120')).toBe('one twenty');
    expect(clipText('speed-205')).toBe('two oh five');
    expect(() => speedClipKey(29)).toThrow(RangeError);
    expect(() => speedClipKey(352)).toThrow(RangeError);
    expect(() => speedClipKey(82)).toThrow(RangeError);
  });

  it('clip_keys_cover_all_phrases', () => {
    expect(SUPPORTED_TARGETS_KPH).toHaveLength(65);
    const keys = allClipKeys();
    expect(keys).toHaveLength(138);
    expect(new Set(keys).size).toBe(138);
    expect(keys.filter(key => key.startsWith('speed-'))).toHaveLength(65);
    expect(keys.filter(key => key.startsWith('focus-'))).toHaveLength(60);
    expect(keys.filter(key => /^(brake|throttle)-\d+$/.test(key))).toEqual([]);
    for (const key of keys) expect(clipText(key).length).toBeGreaterThan(0);
  });
});
