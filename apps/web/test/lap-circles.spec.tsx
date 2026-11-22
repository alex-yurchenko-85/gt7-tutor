import { el } from './support.tsx';
import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LiveRaceLap } from '@gt7/contracts';
import { LapCircles } from '../src/features/races/LapCircles.tsx';

function laps(numbers: number[], pitAfter: number[] = []): LiveRaceLap[] {
  return numbers.map(number => ({ number, timeMs: 140_000 + number, pitAfter: pitAfter.includes(number) }));
}

function classes(): string[] {
  return [...el('.lap-circles').children].map(item => item.className);
}

function key(): string[] {
  return within(el('ul.lap-key'))
    .getAllByRole('listitem')
    .map(item => item.textContent ?? '');
}

describe('lap circles', () => {
  it('gives_each_lap_of_a_race_from_the_grid_its_state', () => {
    render(<LapCircles lapsInRace={7} firstRecordedLap={1} laps={laps([1, 2], [2])} lap={3} bestLap={1} running />);
    expect(classes()).toEqual(['lap-circle done best', 'lap-circle done', 'lap-pit', 'lap-circle now', 'lap-circle', 'lap-circle', 'lap-circle', 'lap-circle']);
    expect(key()).toEqual(['lap done', 'this lap', 'lap to come', 'best lap', 'pit stop after this lap']);
    expect(document.body.textContent).not.toMatch(/\d:\d\d/);
  });

  it('dashes_the_laps_before_the_join_and_the_join_lap_while_it_runs', () => {
    render(<LapCircles lapsInRace={7} firstRecordedLap={5} laps={[]} lap={4} bestLap={null} running />);
    expect(classes()).toEqual(['lap-circle skip', 'lap-circle skip', 'lap-circle skip', 'lap-circle skip', 'lap-circle', 'lap-circle', 'lap-circle']);
    expect(key()).toEqual(['lap not recorded', 'lap to come']);
  });

  it('shows_no_lap_that_runs_in_a_stopped_race', () => {
    render(<LapCircles lapsInRace={7} firstRecordedLap={1} laps={laps([1, 2, 3], [2])} lap={4} bestLap={3} running={false} />);
    expect(classes()).toEqual(['lap-circle done', 'lap-circle done', 'lap-pit', 'lap-circle done best', 'lap-circle', 'lap-circle', 'lap-circle', 'lap-circle']);
    expect(document.querySelector('.lap-circle.now')).toBeNull();
    expect(key()).toEqual(['lap done', 'lap to come', 'best lap', 'pit stop after this lap']);
  });

  it('puts_the_best_lap_ring_only_on_a_done_lap', () => {
    render(<LapCircles lapsInRace={5} firstRecordedLap={1} laps={laps([1])} lap={2} bestLap={2} running />);
    expect(document.querySelectorAll('.lap-circle.best')).toHaveLength(0);
    expect(key()).not.toContain('best lap');
  });

  it('gives_50_circles_for_50_laps', () => {
    render(<LapCircles lapsInRace={50} firstRecordedLap={44} laps={laps([44, 45])} lap={46} bestLap={45} running />);
    expect(el('.lap-circles').querySelectorAll('.lap-circle')).toHaveLength(50);
    expect(key()).toEqual(['lap not recorded', 'lap done', 'this lap', 'lap to come', 'best lap']);
  });
});
