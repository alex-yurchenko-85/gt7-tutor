import { describe, expect, it } from 'vitest';
import { lapsText, positionCaption } from '../src/features/races/race-text.ts';

describe('race text', () => {
  it('says_the_laps_and_puts_not_finished_at_the_end', () => {
    expect(lapsText({ complete: true, firstLap: 1, lapsDone: 5, lapsInRace: 5 })).toBe('5 laps');
    expect(lapsText({ complete: false, firstLap: 1, lapsDone: 3, lapsInRace: 5 })).toBe('3 of 5 laps, not finished');
    expect(lapsText({ complete: false, firstLap: 2, lapsDone: 3, lapsInRace: 5 })).toBe('laps 2 to 4 of 5, not finished');
  });

  it('says_the_position_caption_with_the_same_laps', () => {
    expect(positionCaption(1, 5, true)).toBe('position, start to finish');
    expect(positionCaption(1, 3, false)).toBe('position, start to lap 3');
    expect(positionCaption(2, 4, false)).toBe('position, laps 2 to 4');
  });
});
