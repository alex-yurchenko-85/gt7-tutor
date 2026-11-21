import { useState } from 'react';
import type { AttemptSummary } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { deletionErrorText } from '../../app/busy.ts';
import { ConfirmDialog } from '../../app/ConfirmDialog.tsx';
import { formatTime } from '../../app/format.ts';
import { useTrainingGate } from '../../app/use-training.ts';
import { t } from '../../app/i18n.ts';
import { Rich } from '../../app/rich-text.tsx';

function bestOf(attempts: AttemptSummary[]): number | null {
  const times = attempts.filter(attempt => attempt.completion === 'complete' && attempt.timeMs !== null).map(attempt => attempt.timeMs!);
  return times.length > 0 ? Math.min(...times) : null;
}

type DeleteAttemptsDialogProps = {
  selected: AttemptSummary[];
  all: AttemptSummary[] | null;
  onKeep(): void;
  onDeleted(): void;
};

export function DeleteAttemptsDialog({ selected, all, onKeep, onDeleted }: DeleteAttemptsDialogProps) {
  const [working, setWorking] = useState(false);
  const gate = useTrainingGate('delete');
  const [error, setError] = useState<string | null>(null);
  const one = selected.length === 1;
  const numbers = selected
    .map(attempt => attempt.number)
    .sort((a, b) => a - b)
    .join(', ');
  const ids = new Set(selected.map(attempt => attempt.id));

  const before = all ? bestOf(all) : null;
  const after = all ? bestOf(all.filter(attempt => !ids.has(attempt.id))) : null;
  const bestLine =
    before === null && after === null ? null : before === after ? (
      <li>
        <Rich k="exercises.attempts.best-stays" parts={{ time: <b>{formatTime(before)}</b> }} />
      </li>
    ) : (
      <li>
        <Rich k="exercises.attempts.best-changes" parts={{ before: <b>{formatTime(before)}</b>, after: <b>{formatTime(after)}</b> }} />
      </li>
    );

  const confirm = async () => {
    setWorking(true);
    setError(null);
    try {
      await gate.before();
      await api.deleteAttempts([...ids]);
      onDeleted();
    } catch (failure) {
      setError(deletionErrorText(failure));
      setWorking(false);
    }
  };

  return (
    <ConfirmDialog
      title={one ? t('exercises.attempts.delete-one-title', { number: numbers }) : t('exercises.attempts.delete-many-title', { count: selected.length })}
      keepLabel={one ? t('exercises.attempts.keep-it') : t('exercises.attempts.keep-them')}
      confirmLabel={gate.label(one ? t('exercises.attempts.delete-one') : t('exercises.attempts.delete-selected', { count: selected.length }))}
      working={working}
      confirmDisabled={gate.blocked}
      notice={gate.notice}
      error={error}
      onKeep={onKeep}
      onConfirm={confirm}
    >
      <p>{one ? t('exercises.attempts.goes-one', { numbers }) : t('exercises.attempts.goes-many', { numbers })}</p>
      <ul>
        {bestLine}
        <li>{t('exercises.attempts.recounted')}</li>
        <li>{t('exercises.attempts.stays')}</li>
      </ul>
    </ConfirmDialog>
  );
}
