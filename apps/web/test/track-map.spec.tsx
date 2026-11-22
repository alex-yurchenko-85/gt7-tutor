import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { el } from './support.tsx';
import { TrackMap, type TrackLine } from '../src/charts/TrackMap.tsx';
import * as geometry from '../src/charts/geometry.ts';

vi.mock('../src/charts/geometry.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/charts/geometry.ts')>();
  return { ...actual, lineSegments: vi.fn(actual.lineSegments) };
});

const LINE: TrackLine = { gridM: 2, x: [0, 2, 4, 6, 8, 10], z: [0, 1, 0, 1, 0, 1] };

function peak(turn: number, sM: number) {
  return { turn, sM, title: `T${turn} title`, detail: `T${turn} detail` };
}

function tipText(): string[] {
  return [...document.querySelectorAll('.peak-tip text')].map(text => text.textContent ?? '');
}

describe('track map', () => {
  it('track_map_static_layer_renders_once_while_the_cursor_moves', () => {
    const spy = vi.mocked(geometry.lineSegments);
    spy.mockClear();
    const marks = [{ sM: 4, title: 'Mark' }];
    const view = render(<TrackMap reference={LINE} marks={marks} cursorSM={0} />);
    const first = spy.mock.calls.length;
    const cursor = () => document.querySelector('.track-cursor')?.getAttribute('cx');
    const before = cursor();
    const polyline = document.querySelector('.track-reference');
    expect(first).toBeGreaterThan(0);
    for (const cursorSM of [2, 4, 6, 8]) view.rerender(<TrackMap reference={LINE} marks={marks} cursorSM={cursorSM} />);
    expect(spy.mock.calls.length).toBe(first);
    expect(cursor()).not.toBe(before);
    expect(document.querySelector('.track-reference')).toBe(polyline);
  });

  it('peak_dot_keeps_its_screen_size_when_the_map_is_drawn_smaller', () => {
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
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 400, height: 1000, left: 0, top: 0, right: 400, bottom: 1000, x: 0, y: 0, toJSON: () => ({}) });
    const view = render(<TrackMap reference={LINE} attempt={LINE} peaks={[peak(1, 4)]} />);
    expect(document.querySelector('.track-peak .peak-dot')!.getAttribute('r')).toBe('12');
    expect(Number(document.querySelector('.track-peak .peak-hit')!.getAttribute('r'))).toBeGreaterThanOrEqual(44);
    expect(observed).toHaveLength(1);
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('peak_is_a_dot_on_the_line_named_by_its_tip_without_a_box', () => {
    render(<TrackMap reference={LINE} attempt={LINE} peaks={[peak(1, 4), peak(2, 6)]} />);
    const dots = screen.getAllByRole('button');
    expect(dots.map(dot => dot.getAttribute('data-turn'))).toEqual(['1', '2']);
    const linePoints = document.querySelector('.track-reference')!.getAttribute('points')!.split(' ');
    for (const dot of document.querySelectorAll('.peak-dot')) expect(linePoints).toContain(`${dot.getAttribute('cx')},${dot.getAttribute('cy')}`);
    expect(document.querySelector('.peak-tip')).toBeNull();
    expect(document.querySelector('.track-callout')).toBeNull();
  });

  it('pointer_on_a_dot_shows_its_tip_and_leaving_hides_it', () => {
    render(<TrackMap reference={LINE} attempt={LINE} peaks={[peak(1, 4), peak(2, 6)]} />);
    const dot = el('.track-peak[data-turn="2"]');
    fireEvent.pointerEnter(dot);
    expect(tipText()).toEqual(['T2 title', 'T2 detail']);
    fireEvent.pointerLeave(dot);
    expect(document.querySelector('.peak-tip')).toBeNull();
  });

  it('focus_shows_the_tip_and_escape_or_blur_hides_it', () => {
    render(<TrackMap reference={LINE} attempt={LINE} peaks={[peak(1, 4)]} />);
    const dot = el('.track-peak[data-turn="1"]');
    act(() => dot.focus());
    expect(tipText()).toEqual(['T1 title', 'T1 detail']);
    fireEvent.keyDown(dot, { key: 'Escape' });
    expect(document.querySelector('.peak-tip')).toBeNull();
    act(() => dot.blur());
    act(() => dot.focus());
    expect(tipText()).toEqual(['T1 title', 'T1 detail']);
    act(() => dot.blur());
    expect(document.querySelector('.peak-tip')).toBeNull();
  });

  it('touch_on_a_dot_shows_the_tip_and_touch_away_from_the_dots_hides_it', () => {
    render(<TrackMap reference={LINE} attempt={LINE} peaks={[peak(1, 4), peak(2, 6)]} />);
    fireEvent.click(el('.track-peak[data-turn="1"]'));
    expect(tipText()).toEqual(['T1 title', 'T1 detail']);
    fireEvent.pointerDown(el('.track-peak[data-turn="2"]'));
    fireEvent.click(el('.track-peak[data-turn="2"]'));
    expect(tipText()).toEqual(['T2 title', 'T2 detail']);
    fireEvent.pointerDown(document.querySelector('.track-reference')!);
    expect(document.querySelector('.peak-tip')).toBeNull();
  });

  it('mouse_click_on_a_dot_does_not_keep_the_tip_after_the_pointer_leaves', () => {
    render(<TrackMap reference={LINE} attempt={LINE} peaks={[peak(1, 4)]} />);
    const dot = el('.track-peak[data-turn="1"]');
    fireEvent.pointerEnter(dot, { pointerType: 'mouse' });
    fireEvent.pointerDown(dot, { pointerType: 'mouse' });
    act(() => dot.focus());
    fireEvent.click(dot);
    fireEvent.pointerLeave(dot, { pointerType: 'mouse' });
    expect(document.querySelector('.peak-tip')).toBeNull();
  });

  it('a_touched_tip_does_not_come_back_after_the_dots_go_and_return', () => {
    const view = render(<TrackMap reference={LINE} attempt={LINE} peaks={[peak(1, 4)]} />);
    fireEvent.click(el('.track-peak[data-turn="1"]'));
    expect(tipText()).toEqual(['T1 title', 'T1 detail']);
    view.rerender(<TrackMap reference={LINE} attempt={LINE} peaks={[]} />);
    view.rerender(<TrackMap reference={LINE} attempt={LINE} peaks={[peak(1, 4)]} />);
    expect(document.querySelector('.peak-tip')).toBeNull();
  });

  it('a_focused_dot_keeps_its_ring_after_escape_closes_the_tip', () => {
    render(<TrackMap reference={LINE} attempt={LINE} peaks={[peak(1, 4)]} />);
    const dot = el('.track-peak[data-turn="1"]');
    act(() => dot.focus());
    fireEvent.keyDown(dot, { key: 'Escape' });
    expect(document.querySelector('.peak-tip')).toBeNull();
    expect(dot.querySelector('.peak-ring')).not.toBeNull();
    act(() => dot.blur());
    expect(dot.querySelector('.peak-ring')).toBeNull();
  });

  it('enter_or_space_on_a_dot_shows_the_tip_again_after_escape', () => {
    render(<TrackMap reference={LINE} attempt={LINE} peaks={[peak(1, 4)]} />);
    const dot = el('.track-peak[data-turn="1"]');
    act(() => dot.focus());
    fireEvent.keyDown(dot, { key: 'Escape' });
    expect(document.querySelector('.peak-tip')).toBeNull();
    fireEvent.keyDown(dot, { key: 'Enter' });
    expect(tipText()).toEqual(['T1 title', 'T1 detail']);
    fireEvent.keyDown(dot, { key: 'Escape' });
    fireEvent.keyDown(dot, { key: ' ' });
    expect(tipText()).toEqual(['T1 title', 'T1 detail']);
  });

  it('difference_marks_and_the_cursor_stay_above_the_dots', () => {
    render(<TrackMap reference={LINE} attempt={LINE} peaks={[peak(1, 4)]} marks={[{ sM: 4, title: 'Difference', onAttempt: true, onSelect: () => undefined }]} cursorSM={4} />);
    const order = [...document.querySelector('.track-map')!.children].map(child => child.getAttribute('class') ?? '');
    const peakAt = order.findIndex(name => name.startsWith('track-peak'));
    expect(order.findIndex(name => name.startsWith('track-mark'))).toBeGreaterThan(peakAt);
    expect(order.indexOf('track-cursor')).toBeGreaterThan(peakAt);
    fireEvent.click(el('.track-peak[data-turn="1"]'));
    expect(order.indexOf('track-cursor')).toBeLessThan([...document.querySelector('.track-map')!.children].findIndex(child => child.getAttribute('class') === 'peak-tip'));
  });

  it('a_difference_mark_on_a_dot_keeps_its_touch_and_the_dot_tip_shows_near_it', () => {
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 800, height: 400, left: 0, top: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON: () => ({}) });
    const select = vi.fn();
    render(<TrackMap reference={STRAIGHT} attempt={STRAIGHT} peaks={[peak(1, 200)]} marks={[{ sM: 200, title: 'Difference', onAttempt: true, onSelect: select }]} />);
    const svg = document.querySelector('.track-map') as SVGSVGElement;
    const [, , width, height] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    const dot = document.querySelector('.peak-dot')!;
    const scale = Math.min(800 / width!, 400 / height!);
    const clientX = (800 - width! * scale) / 2 + Number(dot.getAttribute('cx')) * scale;
    const clientY = (400 - height! * scale) / 2 + Number(dot.getAttribute('cy')) * scale;
    const mark = screen.getByRole('button', { name: 'Difference' });
    fireEvent.pointerMove(mark, { pointerType: 'mouse', clientX, clientY });
    expect(tipText()).toEqual(['T1 title', 'T1 detail']);
    fireEvent.pointerMove(svg, { pointerType: 'mouse', clientX: 2, clientY: 2 });
    expect(document.querySelector('.peak-tip')).toBeNull();
    fireEvent.pointerDown(mark, { pointerType: 'touch', clientX, clientY });
    fireEvent.click(mark);
    expect(document.querySelector('.peak-tip')).toBeNull();
    expect(select).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(svg, { pointerType: 'touch', clientX: clientX + 10, clientY: clientY + 12 });
    expect(tipText()).toEqual(['T1 title', 'T1 detail']);
  });

  it('tip_stays_inside_the_map', () => {
    render(<TrackMap reference={STRAIGHT} attempt={STRAIGHT} peaks={[peak(1, 2), peak(2, 398)]} />);
    const [, , width, height] = document.querySelector('.track-map')!.getAttribute('viewBox')!.split(' ').map(Number);
    for (const turn of ['1', '2']) {
      fireEvent.click(el(`.track-peak[data-turn="${turn}"]`));
      const box = document.querySelector('.peak-tip rect')!;
      const x = Number(box.getAttribute('x'));
      const y = Number(box.getAttribute('y'));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + Number(box.getAttribute('width'))).toBeLessThanOrEqual(width!);
      expect(y + Number(box.getAttribute('height'))).toBeLessThanOrEqual(height!);
    }
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
    render(<TrackMap reference={horseshoe} marks={[turn]} />);
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
    const view = render(<TrackMap reference={arc} marks={[turn]} />);
    const free = labelAt();
    view.rerender(<TrackMap reference={arc} marks={[turn, { sM: 100, label: '2', title: 'Mute cue 2' }]} />);
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
    render(<TrackMap reference={STRAIGHT} marks={marks} />);
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
    render(<TrackMap reference={STRAIGHT} marks={[{ sM: 40, label: '1', title: 'Unmute cue 1', muted: true }, { sM: 300, label: '2', title: 'Mute cue 2' }]} />);
    expect(centreOf('1').group.querySelector('.mute-badge')).not.toBeNull();
    expect(centreOf('2').group.querySelector('.mute-badge')).toBeNull();
  });

  it('speaking_mark_has_its_own_class', () => {
    render(<TrackMap reference={STRAIGHT} marks={[{ sM: 40, label: '1', title: 'Mute cue 1', speaking: true }, { sM: 300, label: '2', title: 'Mute cue 2' }]} />);
    expect(centreOf('1').group).toHaveClass('speaking');
    expect(centreOf('2').group).not.toHaveClass('speaking');
  });

  it('not_spoken_mark_has_a_badge', () => {
    render(<TrackMap reference={STRAIGHT} marks={[{ sM: 40, label: '1', title: 'Mute cue 1', notSpoken: true }, { sM: 300, label: '2', title: 'Mute cue 2' }]} />);
    expect(centreOf('1').group.querySelector('.not-spoken-badge')).not.toBeNull();
    expect(centreOf('2').group.querySelector('.not-spoken-badge')).toBeNull();
  });

  it('start_and_finish_are_marked_across_the_line_with_labels_beyond_the_ends', () => {
    render(<TrackMap reference={STRAIGHT} />);
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

  it('lap_line_is_one_bar_across_the_line_with_its_label_beside_the_line', () => {
    render(<TrackMap reference={STRAIGHT} lapLine />);
    const points = document.querySelector('.track-reference')!.getAttribute('points')!.split(' ').map(point => point.split(',').map(Number) as [number, number]);
    const [startX, lineY] = points[0]!;
    expect(document.querySelectorAll('.track-start')).toHaveLength(1);
    expect(document.querySelector('.track-finish')).toBeNull();
    expect(document.querySelector('.track-direction')).toBeNull();
    const labels = [...document.querySelectorAll('.track-label')];
    expect(labels.map(node => node.textContent)).toEqual(['lap line']);
    expect(Math.abs(Number(labels[0]!.getAttribute('x')) - startX)).toBeLessThanOrEqual(24);
    expect(Math.abs(Number(labels[0]!.getAttribute('y')) - lineY)).toBeGreaterThanOrEqual(24);
  });

  it('finish_label_moves_away_when_a_mark_covers_it', () => {
    const finishAt = () => {
      const label = [...document.querySelectorAll('.track-label')].find(node => node.textContent === 'finish')!;
      return [Number(label.getAttribute('x')), Number(label.getAttribute('y'))] as const;
    };
    const view = render(<TrackMap reference={STRAIGHT} />);
    const free = finishAt();
    view.rerender(<TrackMap reference={STRAIGHT} marks={[{ sM: 400, label: '1', title: 'Mute cue 1' }]} />);
    const moved = finishAt();
    const mark = document.querySelector('circle.marker')!;
    expect(moved).not.toEqual(free);
    expect(Math.hypot(Number(mark.getAttribute('cx')) - moved[0], Number(mark.getAttribute('cy')) - moved[1])).toBeGreaterThanOrEqual(13 + 24);
  });

  it('spread_marks_and_end_labels_stay_inside_the_map', () => {
    const marks = [396, 397, 398, 399].map((sM, index) => ({ sM, label: String(index + 1), title: `Mute cue ${index + 1}` }));
    render(<TrackMap reference={STRAIGHT} marks={marks} />);
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
    render(<TrackMap reference={gapped} />);
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
    render(<TrackMap reference={gapped} marks={[{ sM: 80, toSM: 140, kind: 'turn', label: 'T1', title: 'Turn 1' }]} />);
    expect(document.querySelectorAll('.track-turn')).toHaveLength(2);
    expect(document.querySelectorAll('.track-turn-label')).toHaveLength(1);
  });

  it('peaks_at_the_same_distance_keep_their_own_turn', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const both = [peak(1, 4), peak(2, 4)];
    const view = render(<TrackMap reference={LINE} attempt={LINE} peaks={both} />);
    expect(screen.getAllByRole('button').map(dot => dot.getAttribute('data-turn'))).toEqual(['1', '2']);
    view.rerender(<TrackMap reference={LINE} attempt={LINE} peaks={[both[1]!]} />);
    expect(screen.getAllByRole('button').map(dot => dot.getAttribute('data-turn'))).toEqual(['2']);
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/same key/);
  });
});
