import { useState } from 'react';
import type { AttemptSummary } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { deletionErrorText } from '../../app/busy.ts';
import { ConfirmDialog } from '../../app/ConfirmDialog.tsx';
import { formatTime } from '../../app/format.ts';
import { counted } from '../../app/plural.ts';
import { useTrainingGate } from '../../app/use-training.ts';

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
        Your best stays <b>{formatTime(before)}</b>.
      </li>
    ) : (
      <li>
        Your best: <b>{formatTime(before)}</b> → <b>{formatTime(after)}</b>
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
      title={one ? `Delete attempt ${numbers}?` : `Delete ${selected.length} attempts?`}
      keepLabel={one ? 'Keep it' : 'Keep them'}
      confirmLabel={gate.label(one ? 'Delete attempt' : `Delete ${counted(selected.length, 'attempt')}`)}
      working={working}
      confirmDisabled={gate.blocked}
      notice={gate.notice}
      error={error}
      onKeep={onKeep}
      onConfirm={confirm}
    >
      <p>{one ? `Attempt ${numbers}, with its cues and differences.` : `Attempts ${numbers}, with their cues and differences.`}</p>
      <ul>
        {bestLine}
        <li>Recurring differences are counted again from the attempts that stay.</li>
        <li>The references stay. The raw captures stay until you clean them up in Setup.</li>
      </ul>
    </ConfirmDialog>
  );
}
