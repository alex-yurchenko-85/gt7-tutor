import { renderHook } from '@testing-library/react';
import type { PointerEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useCursorPointer } from '../src/charts/cursor-pointer.ts';

function setup() {
  const press = vi.fn();
  const drag = vi.fn();
  const { result } = renderHook(() => useCursorPointer<HTMLDivElement>(press, drag));
  return { pointer: result.current, press, drag };
}

function touch(pointerId: number, clientX: number, clientY: number, pointerType = 'touch') {
  return { pointerId, clientX, clientY, pointerType, buttons: 1 } as unknown as PointerEvent<HTMLDivElement>;
}

describe('cursor pointer hook', () => {
  it('a_tap_presses_once_on_lift', () => {
    const { pointer, press } = setup();
    pointer.onPointerDown(touch(1, 50, 50));
    expect(press).not.toHaveBeenCalled();
    pointer.onPointerUp(touch(1, 52, 51));
    expect(press).toHaveBeenCalledTimes(1);
  });

  it('a_horizontal_drag_presses_at_the_slop_and_then_drags', () => {
    const { pointer, press, drag } = setup();
    pointer.onPointerDown(touch(1, 50, 50));
    pointer.onPointerMove(touch(1, 55, 50));
    expect(press).not.toHaveBeenCalled();
    pointer.onPointerMove(touch(1, 70, 52));
    expect(press).toHaveBeenCalledTimes(1);
    pointer.onPointerMove(touch(1, 90, 52));
    expect(drag).toHaveBeenCalledTimes(1);
    pointer.onPointerUp(touch(1, 90, 52));
    expect(press).toHaveBeenCalledTimes(1);
  });

  it('a_small_vertical_move_is_not_a_tap', () => {
    const { pointer, press } = setup();
    pointer.onPointerDown(touch(1, 50, 50));
    pointer.onPointerMove(touch(1, 51, 62));
    pointer.onPointerUp(touch(1, 51, 62));
    expect(press).not.toHaveBeenCalled();
  });

  it('a_move_under_the_slop_in_any_direction_is_still_a_tap', () => {
    const { pointer, press } = setup();
    pointer.onPointerDown(touch(1, 50, 50));
    pointer.onPointerUp(touch(1, 55, 54));
    expect(press).toHaveBeenCalledTimes(1);
  });

  it('a_cancel_of_a_second_finger_keeps_the_first_finger_tap', () => {
    const { pointer, press } = setup();
    pointer.onPointerDown(touch(1, 50, 50));
    pointer.onPointerCancel(touch(2, 10, 10));
    pointer.onPointerUp(touch(1, 50, 50));
    expect(press).toHaveBeenCalledTimes(1);
  });

  it('a_second_finger_that_goes_down_does_not_take_over_the_first', () => {
    const { pointer, press } = setup();
    pointer.onPointerDown(touch(1, 50, 50));
    pointer.onPointerDown(touch(2, 200, 50));
    pointer.onPointerUp(touch(2, 200, 50));
    expect(press).not.toHaveBeenCalled();
    pointer.onPointerUp(touch(1, 50, 50));
    expect(press).toHaveBeenCalledTimes(1);
  });

  it('a_cancel_of_the_same_finger_drops_its_tap', () => {
    const { pointer, press } = setup();
    pointer.onPointerDown(touch(1, 50, 50));
    pointer.onPointerCancel(touch(1, 50, 50));
    pointer.onPointerUp(touch(1, 50, 50));
    expect(press).not.toHaveBeenCalled();
  });

  it('a_mouse_presses_on_down_and_drags_while_a_button_is_down', () => {
    const { pointer, press, drag } = setup();
    pointer.onPointerDown(touch(1, 50, 50, 'mouse'));
    expect(press).toHaveBeenCalledTimes(1);
    pointer.onPointerMove(touch(1, 60, 50, 'mouse'));
    expect(drag).toHaveBeenCalledTimes(1);
  });
});
