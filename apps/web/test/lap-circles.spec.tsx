import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LiveRaceLap } from '@gt7/contracts';
import { LapCircles } from '../src/features/races/LapCircles.tsx';

function laps(numbers: number[], pitAfter: number[] = []): LiveRaceLap[] {
  return numbers.map(number => ({ number, timeMs: 140_000 + number, pitAfter: pitAfter.includes(number) }));
}

function circles(): string[] {
  return within(screen.getByRole('list', { name: 'Laps' }))
    .getAllByRole('listitem')
    .map(item => item.getAttribute('aria-label') ?? '');
}

function classes(): string[] {
  return [...screen.getByRole('list', { name: 'Laps' }).children].map(item => item.className);
}

function key(): string[] {
  return within(screen.getByRole('list', { name: 'What the circles mean' }))
    .getAllByRole('listitem')
    .map(item => item.textContent ?? '');
}

describe('lap circles', () => {
  it('gives_each_lap_of_a_race_from_the_grid_its_state', () => {
    render(<LapCircles lapsInRace={7} firstRecordedLap={1} laps={laps([1, 2], [2])} lap={3} bestLap={1} running />);
    expect(circles()).toEqual(['Lap 1, done, best lap', 'Lap 2, done', 'Pit stop after lap 2', 'Lap 3, this lap', 'Lap 4, to come', 'Lap 5, to come', 'Lap 6, to come', 'Lap 7, to come']);
    expect(classes()).toEqual(['lap-circle done best', 'lap-circle done', 'lap-pit', 'lap-circle now', 'lap-circle', 'lap-circle', 'lap-circle', 'lap-circle']);
    expect(key()).toEqual(['lap done', 'this lap', 'lap to come', 'best lap', 'pit stop after this lap']);
    expect(document.body.textContent).not.toMatch(/\d:\d\d/);
  });

  it('dashes_the_laps_before_the_join_and_the_join_lap_while_it_runs', () => {
    render(<LapCircles lapsInRace={7} firstRecordedLap={5} laps={[]} lap={4} bestLap={null} running />);
    expect(circles()).toEqual(['Lap 1, not recorded', 'Lap 2, not recorded', 'Lap 3, not recorded', 'Lap 4, not recorded', 'Lap 5, to come', 'Lap 6, to come', 'Lap 7, to come']);
    expect(classes().slice(0, 4)).toEqual(['lap-circle skip', 'lap-circle skip', 'lap-circle skip', 'lap-circle skip']);
    expect(key()).toEqual(['lap not recorded', 'lap to come']);
  });

  it('shows_no_lap_that_runs_in_a_stopped_race', () => {
    render(<LapCircles lapsInRace={7} firstRecordedLap={1} laps={laps([1, 2, 3], [2])} lap={4} bestLap={3} running={false} />);
    expect(circles()).toEqual(['Lap 1, done', 'Lap 2, done', 'Pit stop after lap 2', 'Lap 3, done, best lap', 'Lap 4, to come', 'Lap 5, to come', 'Lap 6, to come', 'Lap 7, to come']);
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
    expect(screen.getByRole('list', { name: 'Laps' }).querySelectorAll('.lap-circle')).toHaveLength(50);
    expect(key()).toEqual(['lap not recorded', 'lap done', 'this lap', 'lap to come', 'best lap']);
  });
});
