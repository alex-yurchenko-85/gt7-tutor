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

  it('turn_is_a_yellow_band_under_the_line_with_its_label_outside_the_curve', () => {
    const points: [number, number][] = [];
    for (let z = 100; z > 0; z -= 2) points.push([-100, z]);
    for (let step = 0; step <= 157; step++) {
      const angle = Math.PI + (step / 157) * Math.PI;
      points.push([100 * Math.cos(angle), 100 * Math.sin(angle)]);
    }
    for (let z = 2; z <= 100; z += 2) points.push([100, z]);
    const horseshoe: TrackLine = { gridM: 2, x: points.map(point => point[0]), z: points.map(point => point[1]) };
    const topIndex = points.reduce((best, point, index) => (point[1] < points[best]![1] ? index : best), 0);
    const turn = { sM: (topIndex - 30) * 2, toSM: (topIndex + 30) * 2, kind: 'turn' as const, label: 'T1', title: 'Turn 1' };
    render(<TrackMap label="Map" reference={horseshoe} marks={[turn]} />);
    const [, , width, height] = document.querySelector('svg')!.getAttribute('viewBox')!.split(' ').map(Number);
    const band = document.querySelector('.track-turn')!;
    const reference = document.querySelector('.track-reference')!;
    expect(band.compareDocumentPosition(reference) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const bandPoints = band.getAttribute('points')!.split(' ').map(point => point.split(',').map(Number) as [number, number]);
    expect(bandPoints).toHaveLength(61);
    const label = [...document.querySelectorAll('.track-turn-label')].find(text => text.textContent === 'T1')!;
    const x = Number(label.getAttribute('x'));
    const y = Number(label.getAttribute('y'));
    expect(y).toBeLessThan(Math.min(...bandPoints.map(point => point[1])));
    expect(y - 14).toBeGreaterThanOrEqual(0);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(width!);
    expect(y).toBeLessThan(height!);
    expect(document.querySelector('.track-mark.apex')).toBeNull();
    expect(document.querySelector('.track-mark.turn-in')).toBeNull();
  });

  it('turn_label_moves_away_from_a_cue_mark', () => {
    const arc: TrackLine = { gridM: 2, x: Array.from({ length: 101 }, (_, index) => 100 * Math.cos(Math.PI + (index / 100) * Math.PI)), z: Array.from({ length: 101 }, (_, index) => 100 * Math.sin(Math.PI + (index / 100) * Math.PI)) };
    const turn = { sM: 60, toSM: 140, kind: 'turn' as const, label: 'T1', title: 'Turn 1' };
    const labelAt = () => {
      const label = document.querySelector('.track-turn-label')!;
      return [Number(label.getAttribute('x')), Number(label.getAttribute('y'))] as const;
    };
    const view = render(<TrackMap label="Map" reference={arc} marks={[turn]} />);
    const free = labelAt();
    view.rerender(<TrackMap label="Map" reference={arc} marks={[turn, { sM: 100, label: '2', title: 'Mute cue 2' }]} />);
    const moved = labelAt();
    const mark = document.querySelector('.track-mark circle.marker')!;
    const distance = Math.hypot(Number(mark.getAttribute('cx')) - moved[0], Number(mark.getAttribute('cy')) - moved[1]);
    expect(moved).not.toEqual(free);
    expect(distance).toBeGreaterThanOrEqual(27);
  });

  const STRAIGHT: TrackLine = { gridM: 2, x: Array.from({ length: 201 }, (_, index) => index * 2), z: Array.from({ length: 201 }, () => 0) };
  const centreOf = (label: string) => {
    const group = [...document.querySelectorAll('.track-mark')].find(mark => mark.querySelector('text')?.textContent === label)!;
    const circle = group.querySelector('circle.marker')!;
    return { group, cx: Number(circle.getAttribute('cx')), cy: Number(circle.getAttribute('cy')) };
  };

  it('close_cue_marks_move_to_the_two_sides_with_a_leader', () => {
    const marks = [
      { sM: 40, label: '1', title: 'Mute cue 1' },
      { sM: 200, label: '2', title: 'Mute cue 2' },
      { sM: 204, label: '3', title: 'Mute cue 3' }
    ];
    render(<TrackMap label="Map" reference={STRAIGHT} marks={marks} />);
    const lineY = Number(document.querySelector('.track-reference')!.getAttribute('points')!.split(' ')[0]!.split(',')[1]);
    const one = centreOf('1');
    const two = centreOf('2');
    const three = centreOf('3');
    expect(one.cy).toBe(lineY);
    expect(one.group.querySelector('line.leader')).toBeNull();
    expect((two.cy - lineY) * (three.cy - lineY)).toBeLessThan(0);
    expect(Math.abs(two.cy - lineY)).toBeGreaterThanOrEqual(26);
    expect(Math.abs(three.cy - lineY)).toBeGreaterThanOrEqual(26);
    for (const mark of [two, three]) {
      const leader = mark.group.querySelector('line.leader')!;
      expect(Number(leader.getAttribute('y1'))).toBe(lineY);
      expect(Number(leader.getAttribute('y2'))).toBe(mark.cy);
    }
  });

  it('muted_cue_mark_shows_a_speaker_badge', () => {
    render(<TrackMap label="Map" reference={STRAIGHT} marks={[{ sM: 40, label: '1', title: 'Unmute cue 1', muted: true }, { sM: 300, label: '2', title: 'Mute cue 2' }]} />);
    expect(centreOf('1').group.querySelector('.mute-badge')).not.toBeNull();
    expect(centreOf('2').group.querySelector('.mute-badge')).toBeNull();
  });

  it('start_and_finish_are_marked_across_the_line_with_labels_beyond_the_ends', () => {
    render(<TrackMap label="Map" reference={STRAIGHT} />);
    const points = document.querySelector('.track-reference')!.getAttribute('points')!.split(' ').map(point => point.split(',').map(Number) as [number, number]);
    const [startX, lineY] = points[0]!;
    const [endX] = points.at(-1)!;
    const bar = document.querySelector('.track-start')!;
    expect(Number(bar.getAttribute('x1'))).toBeCloseTo(startX, 0);
    expect(Number(bar.getAttribute('x2'))).toBeCloseTo(startX, 0);
    expect(Math.abs(Number(bar.getAttribute('y1')) - Number(bar.getAttribute('y2')))).toBeGreaterThan(15);
    const arrow = document.querySelector('.track-direction line')!;
    expect(Number(arrow.getAttribute('x2'))).toBeGreaterThan(Number(arrow.getAttribute('x1')));
    expect(Number(arrow.getAttribute('y1'))).not.toBe(lineY);
    const finish = document.querySelector('.track-finish')!;
    expect(finish.querySelectorAll('rect.on')).toHaveLength(6);
    expect(finish.querySelectorAll('rect.off')).toHaveLength(6);
    expect(finish.getAttribute('transform')).toContain(`translate(${endX} ${lineY})`);
    const label = (text: string) => [...document.querySelectorAll('.track-label')].find(node => node.textContent === text)!;
    expect(Number(label('start').getAttribute('x'))).toBeLessThan(startX);
    expect(Number(label('finish').getAttribute('x'))).toBeGreaterThan(endX);
  });

  it('finish_label_moves_away_when_a_mark_covers_it', () => {
    const finishAt = () => {
      const label = [...document.querySelectorAll('.track-label')].find(node => node.textContent === 'finish')!;
      return [Number(label.getAttribute('x')), Number(label.getAttribute('y'))] as const;
    };
    const view = render(<TrackMap label="Map" reference={STRAIGHT} />);
    const free = finishAt();
    view.rerender(<TrackMap label="Map" reference={STRAIGHT} marks={[{ sM: 400, label: '1', title: 'Mute cue 1' }]} />);
    const moved = finishAt();
    const mark = document.querySelector('circle.marker')!;
    expect(moved).not.toEqual(free);
    expect(Math.hypot(Number(mark.getAttribute('cx')) - moved[0], Number(mark.getAttribute('cy')) - moved[1])).toBeGreaterThanOrEqual(13 + 24);
  });

  it('spread_marks_and_end_labels_stay_inside_the_map', () => {
    const marks = [396, 397, 398, 399].map((sM, index) => ({ sM, label: String(index + 1), title: `Mute cue ${index + 1}` }));
    render(<TrackMap label="Map" reference={STRAIGHT} marks={marks} />);
    const [, , width, height] = document.querySelector('svg')!.getAttribute('viewBox')!.split(' ').map(Number);
    for (const circle of document.querySelectorAll('circle.marker')) {
      const cx = Number(circle.getAttribute('cx'));
      const cy = Number(circle.getAttribute('cy'));
      expect(cx - 13).toBeGreaterThanOrEqual(0);
      expect(cx + 13).toBeLessThanOrEqual(width!);
      expect(cy - 13).toBeGreaterThanOrEqual(0);
      expect(cy + 13).toBeLessThanOrEqual(height!);
    }
    const finish = [...document.querySelectorAll('.track-label')].find(node => node.textContent === 'finish')!;
    expect(Number(finish.getAttribute('x')) + 24).toBeLessThanOrEqual(width!);
  });

  it('start_and_finish_marks_survive_gaps_at_the_ends_of_the_line', () => {
    const gapped: TrackLine = {
      gridM: 2,
      x: STRAIGHT.x.map((x, index) => (index >= 1 && index <= 6) || (index >= 194 && index <= 199) ? null : x),
      z: STRAIGHT.z.map((z, index) => (index >= 1 && index <= 6) || (index >= 194 && index <= 199) ? null : z)
    };
    render(<TrackMap label="Map" reference={gapped} />);
    expect(document.querySelector('.track-start')).not.toBeNull();
    expect(document.querySelector('.track-finish')).not.toBeNull();
    expect([...document.querySelectorAll('.track-label')].map(node => node.textContent)).toEqual(['start', 'finish']);
  });

  it('turn_band_breaks_at_a_gap_in_the_line', () => {
    const gapped: TrackLine = {
      gridM: 2,
      x: STRAIGHT.x.map((x, index) => (index >= 50 && index <= 54 ? null : x)),
      z: STRAIGHT.z.map((z, index) => (index >= 50 && index <= 54 ? null : z))
    };
    render(<TrackMap label="Map" reference={gapped} marks={[{ sM: 80, toSM: 140, kind: 'turn', label: 'T1', title: 'Turn 1' }]} />);
    expect(document.querySelectorAll('.track-turn')).toHaveLength(2);
    expect(document.querySelectorAll('.track-turn-label')).toHaveLength(1);
  });

  it('callouts_keep_clear_of_the_start_arrow', () => {
    const rect = vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 800, height: 400, left: 0, top: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON: () => ({}) });
    render(<TrackMap label="Map" reference={STRAIGHT} attempt={STRAIGHT} callouts={[{ turn: 1, sM: 2, side: -1, title: 'T1', detail: 'at 2 m' }]} />);
    const tip = document.querySelector('.track-direction line')!;
    const tx = Number(tip.getAttribute('x2'));
    const ty = Number(tip.getAttribute('y2'));
    const box = document.querySelector('.track-callout rect')!;
    const bx = Number(box.getAttribute('x'));
    const by = Number(box.getAttribute('y'));
    const inside = tx >= bx && tx <= bx + Number(box.getAttribute('width')) && ty >= by && ty <= by + Number(box.getAttribute('height'));
    expect(inside).toBe(false);
    rect.mockRestore();
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
