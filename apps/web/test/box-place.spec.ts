import { describe, expect, it } from 'vitest';
import { boxColumns, boxLeft } from '../src/charts/box-place.ts';

describe('box place', () => {
  it('puts_the_box_beside_the_cursor_on_the_chosen_side', () => {
    expect(boxLeft(200, 'right', 800, 150)).toBe(212);
    expect(boxLeft(600, 'left', 800, 150)).toBe(438);
  });

  it('keeps_both_edges_of_the_box_inside_the_plot', () => {
    expect(boxLeft(225, 'right', 500, 300)).toBe(192);
    expect(boxLeft(100, 'left', 500, 300)).toBe(8);
  });

  it('starts_a_box_wider_than_the_plot_at_the_left_edge', () => {
    expect(boxLeft(100, 'right', 200, 400)).toBe(8);
  });

  it('gives_fewer_columns_when_they_do_not_fit', () => {
    expect(boxColumns(4, 120, 1000)).toBe(4);
    expect(boxColumns(4, 120, 400)).toBe(3);
    expect(boxColumns(4, 120, 50)).toBe(1);
  });
});
