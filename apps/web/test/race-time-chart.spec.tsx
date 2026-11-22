import { el } from './support.tsx';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RaceTimeChart } from '../src/charts/RaceTimeChart.tsx';

const LAP_ENDS = [100_000, 200_000, 300_000, 400_000];

function chart(step: boolean, points: { tMs: number; value: number }[], pitStops = [{ fromMs: 180_000, toMs: 220_000 }]) {
  render(
    <RaceTimeChart
      id="race-position"
      raceMs={400_000}
      firstLap={5}
      lapEnds={LAP_ENDS}
      pitStops={pitStops}
      points={points}
      step={step}
      min={step ? 20 : 0}
      max={step ? 1 : 100}
      ticks={step ? [1, 10, 20] : [0, 50, 100]}
      tone={step ? 'ink' : 'ref'}
    />
  );
  return el('[data-chart="race-position"]');
}

describe('race time chart', () => {
  it('draws_one_step_per_position_change', () => {
    const figure = chart(true, [
      { tMs: 0, value: 20 },
      { tMs: 50_000, value: 15 },
      { tMs: 150_000, value: 9 },
      { tMs: 320_000, value: 2 }
    ]);
    const d = figure.querySelector('.chart-line.ink')!.getAttribute('d')!;
    expect(d.match(/V/g)).toHaveLength(3);
    expect(d.startsWith('M0 ')).toBe(true);
    expect(d.endsWith('H800')).toBe(true);
    expect(figure.querySelector('.race-chart-end')).not.toBeNull();
  });

  it('puts_1_at_the_top_when_the_scale_runs_from_the_last_place', () => {
    const figure = chart(true, [
      { tMs: 0, value: 1 },
      { tMs: 100_000, value: 20 }
    ]);
    const d = figure.querySelector('.chart-line')!.getAttribute('d')!;
    const [, startY] = /^M0 ([\d.]+)/.exec(d)!;
    expect(Number(startY)).toBeLessThan(10);
  });

  it('draws_one_band_per_pit_stop_and_one_line_per_lap_end', () => {
    const figure = chart(
      false,
      [
        { tMs: 0, value: 100 },
        { tMs: 400_000, value: 40 }
      ],
      [
        { fromMs: 180_000, toMs: 220_000 },
        { fromMs: 280_000, toMs: 320_000 }
      ]
    );
    expect(figure.querySelectorAll('.race-chart-pit')).toHaveLength(2);
    expect(figure.querySelectorAll('.race-chart-lap')).toHaveLength(3);
    expect(figure.querySelector('.chart-line.ref')!.getAttribute('d')).toBe('M0 4L800 83.2');
  });

  it('names_the_laps_under_the_plot_from_the_first_lap', () => {
    const figure = chart(false, [{ tMs: 0, value: 100 }]);
    expect([...figure.querySelectorAll('.race-chart-laps span:not(.axis-pit)')].map(label => label.textContent)).toEqual(['5', '6', '7', '8']);
    expect([...figure.querySelectorAll('.y-axis span')].map(label => label.textContent)).toEqual(['0', '50', '100']);
  });

  it('names_every_fifth_lap_in_a_long_race', () => {
    const ends = Array.from({ length: 25 }, (_, index) => (index + 1) * 100_000);
    render(<RaceTimeChart id="race-position" raceMs={2_500_000} firstLap={1} lapEnds={ends} pitStops={[]} points={[{ tMs: 0, value: 100 }]} step={false} min={0} max={100} ticks={[0, 50, 100]} tone="ref" />);
    const figure = el('[data-chart="race-position"]');
    expect([...figure.querySelectorAll('.race-chart-laps span')].map(label => label.textContent)).toEqual(['1', '5', '10', '15', '20', '25']);
  });

  it('names_every_second_lap_in_a_race_of_15_laps', () => {
    const ends = Array.from({ length: 15 }, (_, index) => (index + 1) * 100_000);
    render(<RaceTimeChart id="race-position" raceMs={1_500_000} firstLap={1} lapEnds={ends} pitStops={[]} points={[{ tMs: 0, value: 100 }]} step={false} min={0} max={100} ticks={[0, 50, 100]} tone="ref" />);
    const figure = el('[data-chart="race-position"]');
    expect([...figure.querySelectorAll('.race-chart-laps span')].map(label => label.textContent)).toEqual(['1', '2', '4', '6', '8', '10', '12', '14']);
  });

  it('shows_the_start_and_the_finish_position_in_bold_and_hides_a_usual_label_closer_than_14_px', () => {
    render(
      <RaceTimeChart
        id="race-position"
        raceMs={400_000}
        firstLap={1}
        lapEnds={LAP_ENDS}
        pitStops={[]}
        points={[{ tMs: 0, value: 20 }]}
        step
        min={20}
        max={1}
        ticks={[1, 10, 20]}
        bold={[20, 2]}
        tone="ink"
        height={220}
      />
    );
    const labels = [...el('[data-chart="race-position"]').querySelectorAll('.y-axis span')];
    expect(labels.map(label => [label.textContent, label.classList.contains('axis-bold')])).toEqual([
      ['10', false],
      ['20', true],
      ['2', true]
    ]);
  });

  it('names_each_pit_stop_under_its_band_and_hides_a_lap_number_that_would_touch_it', () => {
    const figure = chart(false, [{ tMs: 0, value: 100 }], [{ fromMs: 245_000, toMs: 255_000 }]);
    const pit = figure.querySelector('.race-chart-laps .axis-pit')!;
    expect(pit.textContent).toBe('P1');
    expect(pit.getAttribute('style')).toContain('left: 62.5%');
    expect([...figure.querySelectorAll('.race-chart-laps span:not(.axis-pit)')].map(label => label.textContent)).toEqual(['5', '6', '8']);
    expect(figure.querySelector('.race-chart-laps .axis-name')!.textContent).toBe('lap');
  });

  it('numbers_the_pit_stops_in_order', () => {
    const figure = chart(
      false,
      [{ tMs: 0, value: 100 }],
      [
        { fromMs: 95_000, toMs: 105_000 },
        { fromMs: 295_000, toMs: 305_000 }
      ]
    );
    expect([...figure.querySelectorAll('.race-chart-laps .axis-pit')].map(label => label.textContent)).toEqual(['P1', 'P2']);
  });

  it('holds_the_plot_and_both_axes_in_one_field', () => {
    const figure = chart(true, [{ tMs: 0, value: 20 }]);
    expect(figure).toHaveClass('chart-field');
    expect(figure.querySelector('.y-axis')).not.toBeNull();
    expect(figure.querySelector('.race-chart-laps')).not.toBeNull();
  });
});

