import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrackMap, type TrackLine } from '../src/charts/TrackMap.tsx';
import * as geometry from '../src/charts/geometry.ts';

vi.mock('../src/charts/geometry.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/charts/geometry.ts')>();
  return { ...actual, lineSegments: vi.fn(actual.lineSegments) };
});

const LINE: TrackLine = { gridM: 2, x: [0, 2, 4, 6, 8, 10], z: [0, 1, 0, 1, 0, 1] };

describe('track map', () => {
  it('track_map_static_layer_renders_once_while_the_cursor_moves', () => {
    const spy = vi.mocked(geometry.lineSegments);
    spy.mockClear();
    const marks = [{ sM: 4, title: 'Mark' }];
    const view = render(<TrackMap label="Map" reference={LINE} marks={marks} cursorSM={0} />);
    const first = spy.mock.calls.length;
    const cursor = () => document.querySelector('.track-cursor')?.getAttribute('cx');
    const before = cursor();
    const polyline = document.querySelector('.track-reference');
    expect(first).toBeGreaterThan(0);
    for (const cursorSM of [2, 4, 6, 8]) view.rerender(<TrackMap label="Map" reference={LINE} marks={marks} cursorSM={cursorSM} />);
    expect(spy.mock.calls.length).toBe(first);
    expect(cursor()).not.toBe(before);
    expect(document.querySelector('.track-reference')).toBe(polyline);
  });
});
