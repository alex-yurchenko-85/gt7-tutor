import { describe, expect, it } from 'vitest';
import { distanceTicks, signedTickLabel, valueTicks } from '../src/charts/ticks.ts';

describe('chart ticks', () => {
  it('value_ticks_use_round_steps', () => {
    expect(valueTicks(63, 218, 3)).toEqual([100, 150, 200]);
  });

  it('value_ticks_of_time_lost_are_symmetric', () => {
    expect(valueTicks(-1.8, 1.8, 3)).toEqual([-1, 0, 1]);
    expect(valueTicks(-0.11, 0.11, 3)).toEqual([-0.1, -0.05, 0, 0.05, 0.1]);
  });

  it('distance_ticks_every_200_m', () => {
    expect(distanceTicks(1093)).toEqual([0, 200, 400, 600, 800, 1000]);
  });

  it('distance_ticks_skip_a_tick_crowded_at_the_end', () => {
    expect(distanceTicks(20)).toEqual([0, 5, 10, 15]);
  });

  it('signed_tick_label_shows_the_sign', () => {
    expect([signedTickLabel(1, 1), signedTickLabel(0, 1), signedTickLabel(-1, 1), signedTickLabel(0.05, 0.05)]).toEqual(['+1', '0', '−1', '+0.05']);
  });
});
