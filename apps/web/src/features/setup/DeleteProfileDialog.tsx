import { useId, useState } from 'react';
import { api } from '../../api/client.ts';
import { deletionErrorText } from '../../app/busy.ts';
import { ConfirmDialog } from '../../app/ConfirmDialog.tsx';
import { megabytes } from './StorageSection.tsx';
import { useResource } from '../../app/resource.ts';
import { useSession } from '../../app/session.tsx';
import { useTrainingGate } from '../../app/use-training.ts';
import { t } from '../../app/i18n.ts';
import { Rich } from '../../app/rich-text.tsx';

export function DeleteProfileDialog({ onKeep }: { onKeep(): void }) {
  const { user, ended } = useSession();
  const exercises = useResource(() => api.exercises(), []);
  const storage = useResource(() => api.storage(), []);
  const races = useResource(() => api.races(), []);
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const gate = useTrainingGate('delete');
  const [error, setError] = useState<string | null>(null);
  const passwordId = useId();
  const list = exercises.data;
  const attempts = list?.reduce((total, exercise) => total + exercise.attemptCount, 0) ?? null;

  const confirm = async () => {
    setWorking(true);
    setError(null);
    try {
      await gate.before();
      await api.deleteProfile({ password });
      ended();
    } catch (failure) {
      setError(deletionErrorText(failure));
      setWorking(false);
    }
  };

  return (
    <ConfirmDialog
      title={t('setup.delete-profile.title', { name: user.name })}
      keepLabel={t('setup.delete-profile.keep')}
      confirmLabel={gate.label(t('setup.delete-profile.confirm'))}
      working={working}
      confirmDisabled={password.length === 0 || gate.blocked}
      notice={gate.notice}
      error={error}
      onKeep={onKeep}
      onConfirm={confirm}
    >
      <p>{t('setup.delete-profile.goes')}</p>
      <ul>
        <li>
          <Rich k="setup.delete-profile.exercises" params={{ count: list?.length ?? 0 }} parts={{ exercises: <b>{list ? t('common.count.exercise', { count: list.length }) : t('setup.delete-profile.the-exercises')}</b> }} />
        </li>
        <li>
          <Rich k="setup.delete-profile.attempts" params={{ count: attempts ?? 0 }} parts={{ attempts: <b>{attempts === null ? t('setup.delete-profile.the-attempts') : t('common.count.attempt', { count: attempts })}</b> }} />
        </li>
        <li>
          <Rich k="setup.delete-profile.races" params={{ count: races.data?.length ?? 0 }} parts={{ races: <b>{races.data ? t('common.count.race', { count: races.data.length }) : t('setup.delete-profile.the-races')}</b> }} />
        </li>
        <li>
          {storage.data ? (
            <Rich k="setup.delete-profile.captures" params={{ size: megabytes(storage.data.profileRawBytes) }} parts={{ captures: <b>{t('common.count.capture', { count: storage.data.profileCaptures })}</b> }} />
          ) : (
            t('setup.delete-profile.the-captures')
          )}
        </li>
        <li>{t('setup.delete-profile.sign-in')}</li>
      </ul>
      <p>{t('setup.delete-profile.stays')}</p>
      <label className="confirm-field" htmlFor={passwordId}>
        {t('setup.delete-profile.password', { name: user.name })}
      </label>
      <input id={passwordId} className="confirm-input" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} />
    </ConfirmDialog>
  );
}
