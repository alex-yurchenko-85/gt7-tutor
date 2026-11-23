import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Exercise } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { formatTime, parseTargetTime } from '../../app/format.ts';
import { t } from '../../app/i18n.ts';
import { trackTargetSave } from './target-save.ts';

function targetText(targetMs: number | null): string {
  return targetMs === null ? t('exercises.times.no-target') : formatTime(targetMs);
}

export function TargetTime({ exercise, onSaved }: { exercise: Exercise; onSaved(next: Exercise): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  const editing = draft !== null;

  useEffect(() => {
    const input = field.current;
    if (!editing || !input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [editing]);

  const open = () => {
    cancelled.current = false;
    setDraft(exercise.targetMs === null ? '' : formatTime(exercise.targetMs));
  };

  const close = () => {
    const text = draft ?? '';
    setDraft(null);
    if (cancelled.current) return;
    const targetMs = parseTargetTime(text);
    if (targetMs === undefined || targetMs === exercise.targetMs) return;
    void trackTargetSave(api.updateExercise(exercise.id, { targetMs })).then(onSaved, () => undefined);
  };

  const key = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') field.current?.blur();
    if (event.key === 'Escape') {
      cancelled.current = true;
      field.current?.blur();
    }
  };

  return (
    <div className="target-time">
      <span className="target-number">
        <b>{targetText(exercise.targetMs)}</b>
        {editing ? (
          <input ref={field} type="text" inputMode="decimal" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={key} onBlur={close} />
        ) : null}
      </span>
      <span className="target-caption">
        <span>{t('exercises.times.target')}</span>
        <button type="button" className="target-edit" style={{ visibility: editing ? 'hidden' : 'visible' }} onClick={open}>
          {t('exercises.times.edit')}
        </button>
      </span>
    </div>
  );
}
