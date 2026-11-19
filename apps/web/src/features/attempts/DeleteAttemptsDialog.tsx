import { useState } from 'react';
import type { AttemptSummary } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { deletionErrorText } from '../../app/busy.ts';
import { ConfirmDialog } from '../../app/ConfirmDialog.tsx';
import { formatTime } from '../../app/format.ts';
import { counted } from '../../app/plural.ts';

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
  const [error, setError] = useState<string | null>(null);
  const one = selected.length === 1;
  const numbers = selected
    .map(attempt => attempt.number)
    .sort((a, b) => a - b)
    .join(', ');
  const ids = new Set(selected.map(attempt => attempt.id));

  const confirm = async () => {
    setWorking(true);
    setError(null);
    try {
      await api.deleteAttempts([...ids]);
      onDeleted();
    } catch (failure) {
      setError(deletionErrorText(failure));
      setWorking(false);
    }
  };

  return (
    <ConfirmDialog
      title={one ? `Delete attempt ${numbers}?` : `Delete ${selected.length} attempts?`}
      keepLabel={one ? 'Keep it' : 'Keep them'}
      confirmLabel={`Delete ${counted(selected.length, 'attempt')}`}
      working={working}
      error={error}
      onKeep={onKeep}
      onConfirm={confirm}
    >
      <p>{one ? `Attempt ${numbers}, with its cue events and differences.` : `Attempts ${numbers}, with their cue events and differences.`}</p>
      <ul>
        {all ? (
          <li>
            Your best: <b>{formatTime(bestOf(all))}</b> → <b>{formatTime(bestOf(all.filter(attempt => !ids.has(attempt.id))))}</b>
          </li>
        ) : null}
        <li>Recurring differences are counted again from the attempts that stay.</li>
        <li>The references stay. The raw captures stay until you clean them up in Setup.</li>
      </ul>
    </ConfirmDialog>
  );
}
