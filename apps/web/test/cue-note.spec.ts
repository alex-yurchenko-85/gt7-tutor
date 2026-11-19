import type { LiveCue } from '@gt7/contracts';
import { describe, expect, it } from 'vitest';
import { cueNote } from '../src/features/drive/cue-display.ts';
import { CORNERS, CUES } from './fixtures.ts';

function cueAt(sM: number): { live: LiveCue; spoken: typeof CUES } {
  const key = `brake@${sM}`;
  const spoken = [...CUES.filter(item => item.key !== 'brake@332'), { ...CUES[0]!, key, sM }].sort((a, b) => a.sM - b.sM);
  const live = { eventKey: key } as LiveCue;
  return { live, spoken };
}

describe('cueNote', () => {
  it('cue_before_the_zone_names_that_turn', () => {
    const { live, spoken } = cueAt(332);
    expect(cueNote(live, spoken, CORNERS)).toBe('Cue 1 of 3 · before T1');
  });

  it('cue_inside_the_zone_after_the_apex_names_that_turn', () => {
    const { live, spoken } = cueAt(560);
    expect(cueNote(live, spoken, CORNERS)).toBe('Cue 2 of 3 · before T1');
  });

  it('cue_after_the_zone_names_the_next_turn', () => {
    const { live, spoken } = cueAt(640);
    expect(cueNote(live, spoken, CORNERS)).toBe('Cue 3 of 3 · before T2');
  });

  it('cue_after_every_zone_names_no_turn', () => {
    const { live, spoken } = cueAt(950);
    expect(cueNote(live, spoken, CORNERS)).toBe('Cue 3 of 3');
  });
});
