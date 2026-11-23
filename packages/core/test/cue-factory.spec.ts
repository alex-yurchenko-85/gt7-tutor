import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { makeCue } from '../src/cue-factory.ts';

const base = { generation: 7, followClip: null, targetSpeedKph: null, decidedMonoMs: 1234, deviceDelayMs: 60 };

describe('makeCue', () => {
  it('focus_cue_uses_the_policy_priority_and_ttl', () => {
    const focus = makeCue({ ...base, kind: 'focus', eventKey: 'focus', clip: 'focus-approach-brake-late-1' }, DEFAULT_CONFIG);
    expect(focus).toEqual({
      id: '7:focus',
      eventKey: 'focus',
      kind: 'focus',
      targetSpeedKph: null,
      clip: 'focus-approach-brake-late-1',
      followClip: null,
      generation: 7,
      priority: 10,
      decidedMonoMs: 1234,
      ttlMs: 210
    });
  });

  it('spoken_cues_take_priority_from_their_kind_and_ttl_from_the_device_delay', () => {
    const kinds = {
      'hard-brake': 100,
      brake: 100,
      'light-brake': 100,
      'big-stop': 95,
      'ease-off': 90,
      'keep-left': 50,
      'keep-right': 50,
      tighter: 50,
      throttle: 20,
      'full-throttle': 20,
      'guidance-paused': 10,
      'guidance-resumed': 10
    } as const;
    for (const [kind, priority] of Object.entries(kinds)) {
      const cue = makeCue({ ...base, kind: kind as keyof typeof kinds, eventKey: `${kind}@5`, clip: kind, targetSpeedKph: 80, followClip: 'x' }, DEFAULT_CONFIG);
      expect(cue, kind).toMatchObject({ id: `7:${kind}@5`, priority, ttlMs: 210, targetSpeedKph: 80, followClip: 'x' });
    }
  });
});
