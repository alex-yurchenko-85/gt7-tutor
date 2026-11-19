import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackMap, type TrackLine } from '../src/charts/TrackMap.tsx';
import * as geometry from '../src/charts/geometry.ts';
import { coveredPoints } from '../src/charts/callout-place.ts';

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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('callout_keeps_its_screen_size_when_the_map_is_drawn_smaller', () => {
    const observed: Element[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(element: Element) {
          observed.push(element);
        }
        disconnect = disconnect;
      }
    );
    const rect = vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 400, height: 1000, left: 0, top: 0, right: 400, bottom: 1000, x: 0, y: 0, toJSON: () => ({}) });
    const callouts = [{ turn: 1, sM: 4, side: 1 as const, title: 'T1 · 1.0 m right', detail: 'at 4 m' }];
    const view = render(<TrackMap label="Map" reference={LINE} attempt={LINE} callouts={callouts} />);
    const box = document.querySelector('.track-callout rect')!;
    expect(box.getAttribute('width')).toBe('300');
    expect(box.getAttribute('height')).toBe('88');
    expect((document.querySelector('.callout-title') as SVGElement).style.fontSize).toBe('34px');
    expect(observed).toHaveLength(1);
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
    rect.mockRestore();
  });

  it('callout_box_stays_inside_the_map_and_apart_from_the_others', () => {
    const callouts = [
      { turn: 1, sM: 4, side: 1 as const, title: 'T1', detail: 'at 4 m' },
      { turn: 2, sM: 6, side: 1 as const, title: 'T2', detail: 'at 6 m' },
      { turn: 3, sM: 0, side: -1 as const, title: 'T3', detail: 'at 0 m' }
    ];
    render(<TrackMap label="Map" reference={LINE} attempt={LINE} callouts={callouts} />);
    const svg = document.querySelector('.track-map')!;
    const [, , width, height] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    const boxes = [...document.querySelectorAll('.track-callout rect')].map(rect => ({
      x: Number(rect.getAttribute('x')),
      y: Number(rect.getAttribute('y')),
      width: Number(rect.getAttribute('width')),
      height: Number(rect.getAttribute('height'))
    }));
    expect(boxes).toHaveLength(3);
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width!);
      expect(box.y + box.height).toBeLessThanOrEqual(height!);
    }
    const linePoints = document.querySelector('.track-reference')!.getAttribute('points')!.split(' ').map(point => point.split(',').map(Number) as [number, number]);
    for (const box of boxes) expect(coveredPoints(box, linePoints, 0)).toBe(0);
    const dots = [...document.querySelectorAll('.track-callout .callout-dot')].map(dot => `${dot.getAttribute('cx')},${dot.getAttribute('cy')}`);
    expect(dots).toHaveLength(3);
    for (const dot of dots) expect(linePoints.map(point => point.join(','))).toContain(dot);
    const apart = (a: (typeof boxes)[number], b: (typeof boxes)[number]) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
    expect(apart(boxes[0]!, boxes[1]!)).toBe(true);
    expect(apart(boxes[1]!, boxes[2]!)).toBe(true);
    expect(apart(boxes[0]!, boxes[2]!)).toBe(true);
  });

  it('apex_mark_on_the_outer_edge_stays_inside_the_map', () => {
    const points: [number, number][] = [];
    for (let z = 100; z > 0; z -= 2) points.push([-100, z]);
    for (let step = 0; step <= 157; step++) {
      const angle = Math.PI + (step / 157) * Math.PI;
      points.push([100 * Math.cos(angle), 100 * Math.sin(angle)]);
    }
    for (let z = 2; z <= 100; z += 2) points.push([100, z]);
    const horseshoe: TrackLine = { gridM: 2, x: points.map(point => point[0]), z: points.map(point => point[1]) };
    const topIndex = points.reduce((best, point, index) => (point[1] < points[best]![1] ? index : best), 0);
    render(<TrackMap label="Map" reference={horseshoe} marks={[{ sM: topIndex * 2, kind: 'apex', label: '1', title: 'Apex of turn 1' }]} />);
    const [, , width, height] = document.querySelector('svg')!.getAttribute('viewBox')!.split(' ').map(Number);
    const badge = document.querySelectorAll('.track-mark.apex circle')[1]!;
    const cx = Number(badge.getAttribute('cx'));
    const cy = Number(badge.getAttribute('cy'));
    const r = Number(badge.getAttribute('r'));
    const stroke = 2;
    expect(cy - r - stroke).toBeGreaterThanOrEqual(0);
    expect(cy + r + stroke).toBeLessThanOrEqual(height!);
    expect(cx - r - stroke).toBeGreaterThanOrEqual(0);
    expect(cx + r + stroke).toBeLessThanOrEqual(width!);
  });

  it('callouts_at_the_same_distance_keep_their_own_turn', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const both = [
      { turn: 1, sM: 4, side: 1 as const, title: 'T1', detail: 'at 4 m' },
      { turn: 2, sM: 4, side: -1 as const, title: 'T2', detail: 'at 4 m' }
    ];
    const view = render(<TrackMap label="Map" reference={LINE} attempt={LINE} callouts={both} />);
    expect([...document.querySelectorAll('.track-callout .callout-title')].map(title => title.textContent)).toEqual(['T1', 'T2']);
    view.rerender(<TrackMap label="Map" reference={LINE} attempt={LINE} callouts={[both[1]!]} />);
    expect([...document.querySelectorAll('.track-callout .callout-title')].map(title => title.textContent)).toEqual(['T2']);
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/same key/);
  });
});
