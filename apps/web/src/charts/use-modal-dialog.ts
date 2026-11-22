import { useEffect, useRef, type KeyboardEvent, type RefObject, type SyntheticEvent } from 'react';
import { useScrollLock } from '../app/scroll-lock.ts';

export function useModalDialog(open: boolean, onClose: () => void, start?: RefObject<HTMLElement | null>) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useScrollLock(open);
  useEffect(() => {
    const element = ref.current;
    if (!open || !element) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!element.open) element.showModal();
    if (start && !element.contains(document.activeElement)) start.current?.focus();
    return () => {
      if (element.open) element.close();
      opener.current?.focus();
    };
  }, [open, start]);
  return {
    ref,
    onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
      event.preventDefault();
      onClose();
    },
    onKeyDown: (event: KeyboardEvent<HTMLDialogElement>) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    }
  };
}
