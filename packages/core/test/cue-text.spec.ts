import { describe, expect, it } from 'vitest';
import { ENGLISH, focusText } from '@gt7/contracts';
import { replayCoach } from '../src/coach-replay.ts';
import { DEFAULT_CONFIG, DEFAULT_SIDE_CUE_DISTANCE_M } from '../src/config.ts';
import { findCorners } from '../src/corners.ts';
import { buildCueEvents } from '../src/cue-events.ts';
import {
  allClipKeys,
  clipKey,
  clipsOf,
  clipText,
  estimatedPhraseMs,
  eventClips,
  focusClipKey,
  speedClipKey,
  SUPPORTED_TARGETS_KPH,
  targetClip
} from '../src/cue-text.ts';
import { samplesOf } from './fixtures.ts';
import { event } from './coaching.ts';
import { interlagosReference } from './paths.ts';

describe('cue text', () => {
  it('spoken_speeds_come_from_the_voice_pack', () => {
    const spoken = (kph: number) => clipText(ENGLISH, speedClipKey(kph));
    expect(spoken(80)).toBe('eighty');
    expect(spoken(95)).toBe('ninety five');
    expect(spoken(100)).toBe('one hundred');
    expect(spoken(120)).toBe('one twenty');
    expect(spoken(205)).toBe('two oh five');
    expect(spoken(30)).toBe('thirty');
    expect(spoken(115)).toBe('one fifteen');
    expect(spoken(110)).toBe('one ten');
    expect(spoken(300)).toBe('three hundred');
    expect(spoken(350)).toBe('three fifty');
  });

  it('phrases_are_exact', () => {
    const phrase = (clip: string) => clipText(ENGLISH, clip);
    expect(phrase('hard-brake')).toBe('Hard brake');
    expect(phrase('brake')).toBe('Brake');
    expect(phrase('light-brake')).toBe('Light brake');
    expect(phrase('ease-off')).toBe('Lift off');
    expect(phrase('throttle')).toBe('Throttle on');
    expect(phrase('full-throttle')).toBe('Full throttle');
    expect(phrase('keep-left')).toBe('More left');
    expect(phrase('keep-right')).toBe('More right');
    expect(phrase('tighter')).toBe('Closer to apex');
    expect(phrase('big-stop')).toBe('Big brake ahead');
    expect(phrase('guidance-paused')).toBe('Guidance paused');
    expect(phrase('guidance-resumed')).toBe('Guidance resumed');
    expect(phrase('voice-check')).toBe('Voice check');
    expect(clipKey('hard-brake')).toBe('hard-brake');
    expect(() => clipText(ENGLISH, 'no-such-clip')).toThrow(RangeError);
    expect(() => clipText(ENGLISH, 'speed-82')).toThrow(RangeError);
    expect(() => clipText(ENGLISH, 'focus-brake-late-11')).toThrow(RangeError);
  });

  it('focus_text_names_the_turn', () => {
    expect(clipText(ENGLISH, 'focus-brake-early-1')).toBe('Turn one. Brake later.');
    expect(clipText(ENGLISH, 'focus-brake-late-2')).toBe('Turn two. Brake earlier.');
    expect(clipText(ENGLISH, 'focus-brake-late-3')).toBe('Turn three. Brake earlier.');
    expect(clipText(ENGLISH, 'focus-slow-corner-3')).toBe('Turn three. Carry more speed.');
    expect(clipText(ENGLISH, 'focus-throttle-late-4')).toBe('Turn four. Throttle earlier.');
    expect(clipText(ENGLISH, 'focus-wide-apex-10')).toBe('Turn ten. Closer to the apex.');
    expect(focusText(ENGLISH, 'off-line', 11)).toBe('Turn 11. Stay on the line.');
    expect(focusText(ENGLISH, 'brake-late', 11)).toBe('Turn 11. Brake earlier.');
  });

  it('focus_clip_only_up_to_ten', () => {
    expect(focusClipKey('brake-late', 10)).toBe('focus-brake-late-10');
    expect(focusClipKey('brake-early', 1)).toBe('focus-brake-early-1');
    expect(focusClipKey('brake-late', 11)).toBeNull();
    expect(clipText(ENGLISH, 'focus-wide-apex-1')).toBe('Turn one. Closer to the apex.');
  });

  it('speed_clips_say_the_number', () => {
    expect(speedClipKey(85)).toBe('speed-85');
    expect(clipText(ENGLISH, 'speed-85')).toBe('eighty five');
    expect(clipText(ENGLISH, 'speed-120')).toBe('one twenty');
    expect(clipText(ENGLISH, 'speed-205')).toBe('two oh five');
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
    for (const key of keys) expect(clipText(ENGLISH, key).length).toBeGreaterThan(0);
    expect(estimatedPhraseMs(ENGLISH, 'hard-brake')).toBe(640);
    expect(estimatedPhraseMs(ENGLISH, 'focus-brake-late-3')).toBe(1080);
  });

  it('event_clips_of_a_cue', () => {
    const brake = event('brake', 291, 115, 380, { voice: 'hard-brake' });
    expect(clipKey(brake.voice)).toBe('hard-brake');
    expect(targetClip(brake)).toBe('speed-115');
    expect(eventClips(brake, true)).toEqual(['hard-brake', 'speed-115']);
    expect(eventClips(brake, false)).toEqual(['hard-brake']);
    const throttle = event('throttle', 411, 140, null, { voice: 'full-throttle' });
    expect(targetClip(throttle)).toBeNull();
    expect(eventClips(throttle, true)).toEqual(['full-throttle']);
    expect(targetClip(event('brake', 291, null, 380))).toBeNull();
    expect(eventClips(event('brake', 291, null, 380), true)).toEqual(['brake']);
  });

  it('clips_of_a_reference_cover_every_cue_of_its_replay', () => {
    const path = interlagosReference();
    const events = buildCueEvents(path, DEFAULT_CONFIG);
    const corners = findCorners(path, events, DEFAULT_CONFIG);
    const clips = new Set(clipsOf(events, corners));
    for (const sideCueDistanceM of [DEFAULT_SIDE_CUE_DISTANCE_M, 1]) {
      const trace = replayCoach(samplesOf('ce-slow'), { path, events, corners, timeMs: path.points.at(-1)!.timerMs }, DEFAULT_CONFIG, {
        deviceDelayMs: 60,
        phraseMs: clip => estimatedPhraseMs(ENGLISH, clip),
        mutedKeys: new Set(),
        speakTargets: true,
        offsetsMs: new Map(),
        sideCueDistanceM
      });
      const played = trace.cues.flatMap(cue => (cue.followClip ? [cue.clip, cue.followClip] : [cue.clip]));
      expect(played.length).toBeGreaterThan(0);
      expect(played.filter(clip => !clips.has(clip))).toEqual([]);
    }
    for (const clip of ['voice-check', 'keep-left', 'keep-right', 'guidance-paused', 'guidance-resumed', 'tighter']) expect(clips).toContain(clip);
    expect([...clips].filter(clip => clip.startsWith('focus-'))).toHaveLength(6 * Math.min(10, corners.length));
    expect(clips.size).toBe(clipsOf(events, corners).length);
  });
});
