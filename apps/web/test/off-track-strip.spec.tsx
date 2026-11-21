import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RaceRecurringPlace } from '@gt7/contracts';
import { OffTrackStrip } from '../src/charts/OffTrackStrip.tsx';
import { PANORAMA_MOMENTS, PANORAMA_PLACES, offTrackView } from './race-fixtures.ts';

const LAPS = [1, 2, 3, 4, 5, 6, 7];

function strip(overrides: { recurring?: RaceRecurringPlace[]; selected?: number | null } = {}) {
  const onCursor = vi.fn();
  const onSelect = vi.fn();
  render(
    <OffTrackStrip
      lengthM={6165}
      laps={LAPS}
      moments={PANORAMA_MOMENTS}
      recurring={overrides.recurring ?? PANORAMA_PLACES}
      pitLane={offTrackView().pitLane}
      cursorSM={0}
      onCursor={onCursor}
      selected={overrides.selected ?? null}
      onSelect={onSelect}
    />
  );
  return { onCursor, onSelect };
}

function rows(): HTMLElement[] {
  return screen.getAllByRole('group').filter(group => group.hasAttribute('data-lap'));
}

describe('off-track strip', () => {
  it('puts_each_moment_in_the_row_of_its_lap', () => {
    strip();
    expect(rows().map(row => row.getAttribute('data-lap'))).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    const lap3 = rows()[2]!;
    expect(within(lap3).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual([
      'Lap 3, 2,910 m: all four wheels off for 1.0 s, 104 to 64 km/h',
      'Lap 3, 3,190 m: three wheels off for 1.0 s, 104 to 64 km/h'
    ]);
    expect(within(lap3).getAllByRole('button')[0]).toHaveClass('all');
    expect(within(lap3).getAllByRole('button')[1]).toHaveClass('part');
    expect(within(rows()[4]!).queryAllByRole('button')).toHaveLength(0);
  });

  it('draws_the_pit_lane_as_bars_in_the_rows_of_its_laps', () => {
    strip();
    expect(rows().map(row => row.querySelectorAll('.strip-pit').length)).toEqual([0, 1, 1, 0, 1, 1, 0]);
  });

  it('draws_a_band_per_recurring_place', () => {
    strip();
    expect([...document.querySelectorAll('.strip-place')].map(band => band.getAttribute('data-place'))).toEqual(['A', 'B']);
  });

  it('moves_the_letters_of_two_near_places_apart', () => {
    strip({ recurring: [...PANORAMA_PLACES, { ...PANORAMA_PLACES[0]!, label: 'C', sM: 5000, fromSM: 4950, toSM: 5050 }] });
    const letters = [...document.querySelectorAll('.strip-place b')].map(letter => [letter.textContent, letter.className]);
    expect(letters).toEqual([
      ['A', 'before'],
      ['B', 'after'],
      ['C', '']
    ]);
  });

  it('draws_a_place_across_the_lap_line_as_two_bands', () => {
    strip({ recurring: [{ ...PANORAMA_PLACES[0]!, label: 'C', sM: 10, fromSM: 6100, toSM: 60 }] });
    const bands = [...document.querySelectorAll('.strip-place')] as HTMLElement[];
    expect(bands.map(band => band.getAttribute('data-place'))).toEqual(['C', 'C']);
    expect(bands.map(band => [band.style.left, band.style.width])).toEqual([
      [`${((6100 / 6165) * 100).toFixed(3)}%`, `${((65 / 6165) * 100).toFixed(3)}%`],
      ['0%', `${((60 / 6165) * 100).toFixed(3)}%`]
    ]);
  });

  it('selects_a_moment_by_pointer_and_moves_the_cursor_by_pointer', () => {
    const { onSelect, onCursor } = strip();
    fireEvent.click(screen.getByRole('button', { name: /^Lap 6, 3,330 m/ }));
    expect(onSelect).toHaveBeenCalledWith(5);
    const plot = document.querySelector('.strip-plot') as HTMLElement;
    plot.getBoundingClientRect = () => ({ left: 0, top: 0, width: 616.5, height: 100, right: 616.5, bottom: 100, x: 0, y: 0, toJSON: () => null });
    fireEvent.pointerDown(plot, { clientX: 308.25, clientY: 50, pointerType: 'mouse' });
    expect(onCursor).toHaveBeenCalledWith(3082.5);
  });

  it('moves_between_moments_with_the_arrow_keys_and_clears_with_escape', () => {
    const { onSelect } = strip({ selected: 2 });
    const selected = screen.getByRole('button', { name: /^Lap 3, 2,910 m/ });
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(selected, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenLastCalledWith(3);
    fireEvent.keyDown(selected, { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(selected, { key: 'Escape' });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('stops_at_the_first_and_the_last_moment', () => {
    const { onSelect } = strip({ selected: 0 });
    fireEvent.keyDown(screen.getByRole('button', { name: /^Lap 1,/ }), { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenLastCalledWith(0);
  });
});
