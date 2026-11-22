import { useId, useState } from 'react';
import type { DeleteHistoryRequest, DeleteHistoryResult, Exercise } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { deletionErrorText } from '../../app/busy.ts';
import { useTrainingGate } from '../../app/use-training.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { useSession } from '../../app/session.tsx';
import { megabytes } from './StorageSection.tsx';
import { t } from '../../app/i18n.ts';
import { Rich } from '../../app/rich-text.tsx';

type Scope = DeleteHistoryRequest['scope'];

type ScopeText = { title: string; detail: string; deletes: string; keeps: string; action: string };

function scopeTexts(exercises: Exercise[], chosen: Exercise | null, races: number | null): Record<Scope, ScopeText> {
  const attempts = exercises.reduce((total, exercise) => total + exercise.attemptCount, 0);
  const references = exercises.reduce((total, exercise) => total + exercise.referenceCount, 0);
  const withAttempts = exercises.filter(exercise => exercise.attemptCount > 0).length;
  const chosenAttempts = chosen?.attemptCount ?? 0;
  const chosenName = chosen?.name ?? t('setup.history.the-exercise');
  return {
    exercise: {
      title: t('setup.history.exercise.title'),
      detail: t('setup.history.exercise.detail'),
      deletes: t('setup.history.exercise.deletes', { count: chosenAttempts, name: chosenName }),
      keeps: t('setup.history.exercise.keeps'),
      action: t('setup.history.exercise.action', { count: chosenAttempts })
    },
    attempts: {
      title: t('setup.history.attempts.title'),
      detail: t('setup.history.attempts.detail', { attempts: t('common.count.attempt', { count: attempts }), exercises: t('common.count.exercise', { count: withAttempts }) }),
      deletes: t('setup.history.attempts.deletes', { count: attempts }),
      keeps: t('setup.history.attempts.keeps'),
      action: t('setup.history.attempts.action')
    },
    everything: {
      title: t('setup.history.everything.title'),
      detail: t('setup.history.everything.detail'),
      deletes: t('setup.history.everything.deletes', {
        attempts: t('common.count.attempt', { count: attempts }),
        references: t('common.count.reference', { count: references }),
        races: races === null ? t('setup.history.the-races') : t('common.count.race', { count: races }),
        exercises: t('common.count.exercise', { count: exercises.length })
      }),
      keeps: t('setup.history.everything.keeps'),
      action: t('setup.history.everything.action')
    }
  };
}

const SCOPES: Scope[] = ['exercise', 'attempts', 'everything'];

function listed(parts: string[]): string {
  return parts.length > 1 ? t('setup.history.list-and', { first: parts.slice(0, -1).join(', '), last: parts.at(-1)! }) : parts[0]!;
}

function doneText(result: DeleteHistoryResult): string {
  const parts = [t('common.count.attempt', { count: result.attempts }), result.references > 0 ? t('common.count.reference', { count: result.references }) : null, result.races > 0 ? t('common.count.race', { count: result.races }) : null];
  const deleted = t('setup.history.deleted', { items: listed(parts.filter((part): part is string => part !== null)) });
  if (!result.cleanup) return deleted;
  return `${deleted} ${t('setup.storage.cleaned', { count: result.cleanup.captures, before: megabytes(result.cleanup.bytesBefore), after: megabytes(result.cleanup.bytesAfter) })}`;
}

function DataSummary({ exercises }: { exercises: Exercise[] | null }) {
  const storage = useResource(() => api.storage(), []);
  const attempts = exercises?.reduce((total, exercise) => total + exercise.attemptCount, 0) ?? null;
  const withAttempts = exercises?.filter(exercise => exercise.attemptCount > 0).length ?? 0;
  return (
    <section className="panel setup-section">
      <h2>{t('setup.history.data')}</h2>
      <div className="kv">
        <span>{t('setup.storage.yours')}</span>
        <b>{storage.data ? t('setup.storage.yours-size', { size: megabytes(storage.data.profileRawBytes), count: storage.data.profileCaptures }) : storage.error ? errorText(storage.error) : '…'}</b>
      </div>
      <div className="kv">
        <span>{t('setup.history.your-attempts')}</span>
        <b>{attempts === null ? '…' : t('setup.history.your-attempts-size', { number: attempts, exercises: t('common.count.exercise', { count: withAttempts }) })}</b>
      </div>
    </section>
  );
}

export function DeleteHistoryView() {
  const { user } = useSession();
  const exercises = useResource(() => api.exercises(), []);
  const races = useResource(() => api.races(), []);
  const [scope, setScope] = useState<Scope>('attempts');
  const [exerciseId, setExerciseId] = useState<string | null>(null);
  const [cleanup, setCleanup] = useState(true);
  const [typed, setTyped] = useState('');
  const [working, setWorking] = useState(false);
  const gate = useTrainingGate('delete');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirmId = useId();
  const list = exercises.data ?? [];
  const chosen = list.find(exercise => exercise.id === exerciseId) ?? list[0] ?? null;
  const texts = scopeTexts(list, chosen, races.data?.length ?? null);
  const current = texts[scope];
  const matches = typed === user.name;

  const submit = async () => {
    setWorking(true);
    setError(null);
    setDone(null);
    try {
      await gate.before();
      const body: DeleteHistoryRequest = scope === 'exercise' ? { scope, exerciseId: chosen!.id, cleanup } : { scope, cleanup };
      setDone(doneText(await api.deleteHistory(body)));
      setTyped('');
      exercises.reload();
      races.reload();
    } catch (failure) {
      setError(deletionErrorText(failure));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="delete-history">
      <DataSummary exercises={exercises.data} />
      <section className="panel setup-section history-danger">
        <h2>{t('setup.history.title')}</h2>
        <p className="sub">
          <Rich k="setup.history.profile-only" parts={{ name: <b className="history-name">{user.name}</b> }} />
        </p>
        <fieldset className="history-scopes">
          <legend>{t('setup.history.what')}</legend>
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
            {t('setup.history.exercise-field')}
            <select value={chosen?.id ?? ''} onChange={event => setExerciseId(event.target.value)}>
              {list.map(exercise => (
                <option key={exercise.id} value={exercise.id}>
                  {t('setup.history.exercise-option', { name: exercise.name, attempts: t('common.count.attempt', { count: exercise.attemptCount }) })}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="history-cleanup">
          <input type="checkbox" checked={cleanup} onChange={event => setCleanup(event.target.checked)} />
          <span>
            {t('setup.history.cleanup')}
            <span className="sub">{t('setup.history.cleanup-text')}</span>
          </span>
        </label>
        <div className="history-summary">
          <p>
            <b>{t('setup.history.deletes')}</b> {current.deletes}
          </p>
          <p>
            <b>{t('setup.history.keeps')}</b> {current.keeps}
          </p>
        </div>
        <label className="history-field" htmlFor={confirmId}>
          <span>
            <Rich k="setup.history.confirm" parts={{ name: <code className="history-name">{user.name}</code> }} />
          </span>
        </label>
        <input id={confirmId} className="history-confirm" type="text" autoComplete="off" value={typed} onChange={event => setTyped(event.target.value)} />
        {gate.notice ? <p className="notice">{gate.notice}</p> : null}
        <div className="history-actions">
          <button type="button" className="btn destructive inline" disabled={!matches || working || gate.blocked} onClick={submit}>
            {gate.label(current.action)}
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
