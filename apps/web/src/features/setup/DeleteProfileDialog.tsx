import { useId, useState } from 'react';
import { api } from '../../api/client.ts';
import { deletionErrorText } from '../../app/busy.ts';
import { ConfirmDialog } from '../../app/ConfirmDialog.tsx';
import { counted, theirs } from '../../app/plural.ts';
import { megabytes } from './StorageSection.tsx';
import { useResource } from '../../app/resource.ts';
import { useSession } from '../../app/session.tsx';

export function DeleteProfileDialog({ onKeep }: { onKeep(): void }) {
  const { user, ended } = useSession();
  const exercises = useResource(() => api.exercises(), []);
  const storage = useResource(() => api.storage(), []);
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordId = useId();
  const list = exercises.data;
  const attempts = list?.reduce((total, exercise) => total + exercise.attemptCount, 0) ?? null;

  const confirm = async () => {
    setWorking(true);
    setError(null);
    try {
      await api.deleteProfile({ password });
      ended();
    } catch (failure) {
      setError(deletionErrorText(failure));
      setWorking(false);
    }
  };

  return (
    <ConfirmDialog
      title={`Delete the profile ${user.name}?`}
      keepLabel="Keep it"
      confirmLabel="Delete profile"
      working={working}
      confirmDisabled={password.length === 0}
      error={error}
      onKeep={onKeep}
      onConfirm={confirm}
    >
      <p>Everything of this profile goes:</p>
      <ul>
        <li>
          <b>{list ? counted(list.length, 'exercise') : 'the exercises'}</b> with {theirs(list?.length ?? 0)} references
        </li>
        <li>
          <b>{attempts === null ? 'the attempts' : counted(attempts, 'attempt')}</b> with {theirs(attempts ?? 0)} cues and differences
        </li>
        <li>
          {storage.data ? (
            <>
              <b>{counted(storage.data.profileCaptures, 'capture')}</b> on this computer, {megabytes(storage.data.profileRawBytes)}
            </>
          ) : (
            'the captures of this profile on this computer'
          )}
        </li>
        <li>the sign-in on every device</li>
      </ul>
      <p>Other profiles and the settings of this computer stay. You cannot undo this.</p>
      <label className="confirm-field" htmlFor={passwordId}>
        Enter the password of {user.name} to confirm
      </label>
      <input id={passwordId} className="confirm-input" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} />
    </ConfirmDialog>
  );
}
