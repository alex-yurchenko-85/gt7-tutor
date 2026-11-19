import { useId, useState } from 'react';
import type { DeleteHistoryRequest, DeleteHistoryResult, Exercise } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { deletionErrorText } from '../../app/busy.ts';
import { counted, theirs } from '../../app/plural.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { useSession } from '../../app/session.tsx';
import { megabytes } from './StorageSection.tsx';

type Scope = DeleteHistoryRequest['scope'];

type ScopeText = { title: string; detail: string; deletes: string; keeps: string; action: string };

function scopeTexts(exercises: Exercise[], chosen: Exercise | null): Record<Scope, ScopeText> {
  const attempts = exercises.reduce((total, exercise) => total + exercise.attemptCount, 0);
  const references = exercises.reduce((total, exercise) => total + exercise.referenceCount, 0);
  const withAttempts = exercises.filter(exercise => exercise.attemptCount > 0).length;
  const chosenAttempts = chosen?.attemptCount ?? 0;
  return {
    exercise: {
      title: 'Attempts of one exercise',
      detail: 'For a fresh start on one exercise. Its references stay.',
      deletes: `${counted(chosenAttempts, 'attempt')} of ${chosen?.name ?? 'the exercise'}, with ${theirs(chosenAttempts)} cue events and differences.`,
      keeps: 'the references, the other exercises, the settings.',
      action: `Delete ${counted(chosenAttempts, 'attempt')}`
    },
    attempts: {
      title: 'All attempts',
      detail: `${counted(attempts, 'attempt')} in ${counted(withAttempts, 'exercise')}. References and exercises stay.`,
      deletes: `${attempts === 1 ? 'the' : 'all'} ${counted(attempts, 'attempt')} of this profile, with ${theirs(attempts)} cue events and differences.`,
      keeps: 'the exercises, the references, the settings.',
      action: 'Delete all attempts'
    },
    everything: {
      title: 'Start over',
      detail: 'All attempts, references and exercise progress. The profile and its settings stay.',
      deletes: `${counted(attempts, 'attempt')}, ${counted(references, 'reference')}, the progress of ${counted(exercises.length, 'exercise')}.`,
      keeps: 'the profile, the password, the voice and console settings, the catalogue.',
      action: 'Delete everything and start over'
    }
  };
}

const SCOPES: Scope[] = ['exercise', 'attempts', 'everything'];

function doneText(result: DeleteHistoryResult): string {
  const deleted = `Deleted ${counted(result.attempts, 'attempt')}${result.references > 0 ? ` and ${counted(result.references, 'reference')}` : ''}.`;
  if (!result.cleanup) return deleted;
  return `${deleted} Cleaned ${counted(result.cleanup.captures, 'capture')}: ${megabytes(result.cleanup.bytesBefore)} before, ${megabytes(result.cleanup.bytesAfter)} after.`;
}

function DataSummary({ exercises }: { exercises: Exercise[] | null }) {
  const storage = useResource(() => api.storage(), []);
  const attempts = exercises?.reduce((total, exercise) => total + exercise.attemptCount, 0) ?? null;
  const withAttempts = exercises?.filter(exercise => exercise.attemptCount > 0).length ?? 0;
  return (
    <section className="panel setup-section" aria-labelledby="history-data-title">
      <h2 id="history-data-title">Data</h2>
      <div className="kv">
        <span>Your captures</span>
        <b>{storage.data ? `${megabytes(storage.data.profileRawBytes)} in ${counted(storage.data.profileCaptures, 'capture')}` : storage.error ? errorText(storage.error) : '…'}</b>
      </div>
      <div className="kv">
        <span>Your attempts</span>
        <b>{attempts === null ? '…' : `${attempts} in ${counted(withAttempts, 'exercise')}`}</b>
      </div>
    </section>
  );
}

export function DeleteHistoryView() {
  const { user } = useSession();
  const exercises = useResource(() => api.exercises(), []);
  const [scope, setScope] = useState<Scope>('attempts');
  const [exerciseId, setExerciseId] = useState<string | null>(null);
  const [cleanup, setCleanup] = useState(true);
  const [typed, setTyped] = useState('');
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirmId = useId();
  const list = exercises.data ?? [];
  const chosen = list.find(exercise => exercise.id === exerciseId) ?? list[0] ?? null;
  const texts = scopeTexts(list, chosen);
  const current = texts[scope];
  const matches = typed === user.name;

  const submit = async () => {
    setWorking(true);
    setError(null);
    setDone(null);
    try {
      const body: DeleteHistoryRequest = scope === 'exercise' ? { scope, exerciseId: chosen!.id, cleanup } : { scope, cleanup };
      setDone(doneText(await api.deleteHistory(body)));
      setTyped('');
      exercises.reload();
    } catch (failure) {
      setError(deletionErrorText(failure));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="delete-history">
      <DataSummary exercises={exercises.data} />
      <section className="panel setup-section history-danger" aria-labelledby="history-title">
        <h2 id="history-title">Delete history</h2>
        <p className="sub">
          This affects the profile <b className="history-name">{user.name}</b> only. It cannot be undone.
        </p>
        <fieldset className="history-scopes">
          <legend>What to delete</legend>
          {SCOPES.map(id => (
            <label key={id} className={id === scope ? 'history-scope chosen' : 'history-scope'}>
              <input type="radio" name="history-scope" checked={id === scope} disabled={id === 'exercise' && list.length === 0} onChange={() => setScope(id)} />
              <span>
                <b>{texts[id].title}</b>{' '}
                <span className="sub">{texts[id].detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {scope === 'exercise' ? (
          <label className="history-field">
            Exercise
            <select value={chosen?.id ?? ''} onChange={event => setExerciseId(event.target.value)}>
              {list.map(exercise => (
                <option key={exercise.id} value={exercise.id}>
                  {exercise.name} ({counted(exercise.attemptCount, 'attempt')})
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="history-cleanup">
          <input type="checkbox" checked={cleanup} onChange={event => setCleanup(event.target.checked)} />
          <span>
            Also clean up the raw captures that nothing uses afterwards
            <span className="sub">Frees disk space. Without this, Clean up captures can do it later.</span>
          </span>
        </label>
        <div className="history-summary">
          <p>
            <b>This deletes:</b> {current.deletes}
          </p>
          <p>
            <b>This keeps:</b> {current.keeps}
          </p>
        </div>
        <label className="history-field" htmlFor={confirmId}>
          <span>
            Type the profile name <code className="history-name">{user.name}</code> to confirm
          </span>
        </label>
        <input id={confirmId} className="history-confirm" type="text" autoComplete="off" value={typed} onChange={event => setTyped(event.target.value)} />
        <div className="history-actions">
          <button type="button" className="btn destructive inline" disabled={!matches || working} onClick={submit}>
            {current.action}
          </button>
        </div>
        {done ? (
          <p className="notice" role="status">
            {done}
          </p>
        ) : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
