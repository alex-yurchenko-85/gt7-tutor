import { describe, expect, it } from 'vitest';
import { turnLabelPlaces } from '../src/charts/turn-labels.ts';

describe('turn label places', () => {
  it('adjacent_narrow_bands_use_different_rows', () => {
    const places = turnLabelPlaces(
      [
        { fromSM: 346, toSM: 362, label: 'T1' },
        { fromSM: 362, toSM: 380, label: 'T2' }
      ],
      4000,
      800
    );
    expect(places.map(place => place.row)).toEqual([0, 1]);
  });

  it('far_apart_bands_share_the_first_row', () => {
    const places = turnLabelPlaces(
      [
        { fromSM: 400, toSM: 500, label: 'T1' },
        { fromSM: 2000, toSM: 2100, label: 'T2' }
      ],
      4000,
      800
    );
    expect(places.map(place => place.row)).toEqual([0, 0]);
  });

  it('a_third_label_returns_to_the_first_row_when_it_is_free', () => {
    const bands = [
      { fromSM: 346, toSM: 362, label: 'T1' },
      { fromSM: 362, toSM: 380, label: 'T2' },
      { fromSM: 500, toSM: 520, label: 'T3' }
    ];
    expect(turnLabelPlaces(bands, 4000, 800).map(place => place.row)).toEqual([0, 1, 0]);
  });

  it('labels_stay_inside_the_plot_at_both_ends', () => {
    const places = turnLabelPlaces(
      [
        { fromSM: 0, toSM: 10, label: 'T1' },
        { fromSM: 3990, toSM: 4000, label: 'T9' }
      ],
      4000,
      800
    );
    expect(places[0]!.centre).toBe(8);
    expect(places[1]!.centre).toBe(792);
  });

  it('drops_a_label_that_fits_in_no_row_when_asked', () => {
    const bands = ['T1', 'T2', 'T3', 'T4'].map((label, index) => ({ fromSM: 100 + index * 10, toSM: 105 + index * 10, label }));
    expect(turnLabelPlaces(bands, 4000, 800).map(place => place.label)).toEqual(['T1', 'T2', 'T3', 'T4']);
    expect(turnLabelPlaces(bands, 4000, 800, true).map(place => [place.label, place.row])).toEqual([
      ['T1', 0],
      ['T2', 1]
    ]);
  });
});

