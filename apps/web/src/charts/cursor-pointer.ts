import { useRef, type PointerEvent } from 'react';

const SLOP_PX = 8;

type Touch = { id: number; x: number; y: number; dragging: boolean };

export type CursorPointer<E extends Element> = {
  onPointerDown(event: PointerEvent<E>): void;
  onPointerMove(event: PointerEvent<E>): void;
  onPointerUp(event: PointerEvent<E>): void;
  onPointerCancel(event: PointerEvent<E>): void;
};

export function useCursorPointer<E extends Element>(press: (event: PointerEvent<E>) => void, drag: (event: PointerEvent<E>) => void): CursorPointer<E> {
  const touch = useRef<Touch | null>(null);
  return {
    onPointerDown(event) {
      if (event.pointerType !== 'touch') {
        press(event);
        return;
      }
      if (touch.current === null) touch.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
    },
    onPointerMove(event) {
      if (event.pointerType !== 'touch') {
        if (event.buttons > 0 || event.pointerType === 'mouse') drag(event);
        return;
      }
      const start = touch.current;
      if (!start || start.id !== event.pointerId) return;
      if (start.dragging) {
        drag(event);
        return;
      }
      const across = Math.abs(event.clientX - start.x);
      if (across >= SLOP_PX && across > Math.abs(event.clientY - start.y)) {
        start.dragging = true;
        press(event);
      }
    },
    onPointerUp(event) {
      const start = touch.current;
      if (event.pointerType !== 'touch' || !start || start.id !== event.pointerId) return;
      touch.current = null;
      const still = Math.abs(event.clientX - start.x) < SLOP_PX && Math.abs(event.clientY - start.y) < SLOP_PX;
      if (!start.dragging && still) press(event);
    },
    onPointerCancel(event) {
      if (touch.current?.id === event.pointerId) touch.current = null;
    }
  };
}
