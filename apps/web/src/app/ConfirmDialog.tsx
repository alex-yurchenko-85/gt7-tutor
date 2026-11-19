import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useScrollLock } from './scroll-lock.ts';

type ConfirmDialogProps = {
  title: string;
  children: ReactNode;
  keepLabel: string;
  confirmLabel: string;
  working?: boolean;
  confirmDisabled?: boolean;
  error?: string | null;
  onKeep(): void;
  onConfirm(): void;
};

export function ConfirmDialog({ title, children, keepLabel, confirmLabel, working = false, confirmDisabled = false, error = null, onKeep, onConfirm }: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useScrollLock(true);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!element.open) element.showModal();
    keep.current?.focus();
    return () => {
      if (element.open) element.close();
      opener?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="confirm-dialog"
      onCancel={event => {
        event.preventDefault();
        if (!working) onKeep();
      }}
      onKeyDown={event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        if (!working) onKeep();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <div id={bodyId} className="confirm-body">
        {children}
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="confirm-actions">
        <button ref={keep} type="button" className="btn ghost inline" onClick={onKeep} disabled={working}>
          {keepLabel}
        </button>
        <button type="button" className="btn destructive inline" onClick={onConfirm} disabled={working || confirmDisabled}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
