import { useEffect, useRef, type ReactNode } from 'react';
import { useScrollLock } from './scroll-lock.ts';

type ConfirmDialogProps = {
  title: string;
  children: ReactNode;
  keepLabel: string;
  confirmLabel: string;
  working?: boolean;
  confirmDisabled?: boolean;
  error?: string | null;
  notice?: ReactNode;
  role?: 'alertdialog' | 'dialog';
  confirmTone?: 'destructive' | 'primary';
  onKeep(): void;
  onConfirm(): void;
};

export function ConfirmDialog({ title, children, keepLabel, confirmLabel, working = false, confirmDisabled = false, error = null, notice = null, role = 'alertdialog', confirmTone = 'destructive', onKeep, onConfirm }: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
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
      role={role}
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
      <h2>{title}</h2>
      <div className="confirm-body">
        {children}
      </div>
      {notice ? <p className="notice">{notice}</p> : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="confirm-actions">
        <button ref={keep} type="button" className="btn ghost inline" onClick={onKeep} disabled={working}>
          {keepLabel}
        </button>
        <button type="button" className={confirmTone === 'destructive' ? 'btn destructive inline' : 'btn inline'} onClick={onConfirm} disabled={working || confirmDisabled}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
