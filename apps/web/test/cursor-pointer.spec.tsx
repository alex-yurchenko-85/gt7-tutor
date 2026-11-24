import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelChart } from '../src/charts/ChannelChart.tsx';
import { el } from './support.tsx';

function plotOf() {
  const onCursor = vi.fn();
  const onScrub = vi.fn();
  render(
    <ChannelChart
      id="speed"
      label="Speed"
      series={[{ name: 'ref', values: [100, 120, 140] }]}
      min={0}
      max={200}
      gridM={2}
      lengthM={400}
      cursorSM={0}
      onCursor={onCursor}
      onScrub={onScrub}
      readout="x"
      ticks={[{ value: 100, label: '100' }]}
    />
  );
  const plot = el('[data-chart="speed"]');
  plot.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 100, right: 400, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
  return { plot, onCursor, onScrub };
}

const touch = (clientX: number, clientY: number) => ({ pointerType: 'touch', pointerId: 7, clientX, clientY });

afterEach(cleanup);

describe('chart pointer on touch', () => {
  it('a_finger_that_goes_down_does_not_move_the_cursor_until_it_lifts', () => {
    const { plot, onCursor } = plotOf();
    fireEvent.pointerDown(plot, touch(100, 50));
    expect(onCursor).not.toHaveBeenCalled();
    fireEvent.pointerUp(plot, touch(100, 50));
    expect(onCursor).toHaveBeenCalledTimes(1);
    expect(onCursor).toHaveBeenCalledWith(100);
  });

  it('a_horizontal_drag_moves_the_cursor_to_the_finger_and_follows_it', () => {
    const { plot, onCursor, onScrub } = plotOf();
    fireEvent.pointerDown(plot, touch(100, 50));
    fireEvent.pointerMove(plot, touch(104, 51));
    expect(onCursor).not.toHaveBeenCalled();
    fireEvent.pointerMove(plot, touch(130, 52));
    expect(onCursor).toHaveBeenCalledWith(130);
    fireEvent.pointerMove(plot, touch(160, 52));
    expect(onScrub).toHaveBeenCalledWith(160);
    fireEvent.pointerUp(plot, touch(160, 52));
    expect(onCursor).toHaveBeenCalledTimes(1);
  });

  it('a_vertical_swipe_that_the_browser_takes_for_scroll_leaves_the_cursor_alone', () => {
    const { plot, onCursor, onScrub } = plotOf();
    fireEvent.pointerDown(plot, touch(100, 50));
    fireEvent.pointerMove(plot, touch(102, 80));
    fireEvent.pointerCancel(plot, touch(102, 80));
    fireEvent.pointerUp(plot, touch(102, 80));
    expect(onCursor).not.toHaveBeenCalled();
    expect(onScrub).not.toHaveBeenCalled();
  });

  it('a_cancelled_touch_does_not_make_the_next_tap_a_drag', () => {
    const { plot, onCursor } = plotOf();
    fireEvent.pointerDown(plot, touch(100, 50));
    fireEvent.pointerCancel(plot, touch(100, 50));
    fireEvent.pointerMove(plot, touch(200, 50));
    expect(onCursor).not.toHaveBeenCalled();
    fireEvent.pointerDown(plot, touch(40, 50));
    fireEvent.pointerUp(plot, touch(40, 50));
    expect(onCursor).toHaveBeenCalledWith(40);
  });

  it('a_mouse_still_presses_on_down_and_scrubs_with_a_button_down', () => {
    const { plot, onCursor, onScrub } = plotOf();
    fireEvent.pointerDown(plot, { pointerType: 'mouse', clientX: 100, clientY: 50 });
    expect(onCursor).toHaveBeenCalledWith(100);
    fireEvent.pointerMove(plot, { pointerType: 'mouse', clientX: 140, clientY: 50 });
    expect(onScrub).toHaveBeenCalledWith(140);
  });
});
