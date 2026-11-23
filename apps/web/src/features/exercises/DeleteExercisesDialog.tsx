import { useState } from 'react';
import type { Exercise } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { deletionErrorText } from '../../app/busy.ts';
import { ConfirmDialog } from '../../app/ConfirmDialog.tsx';
import { announceExercisesChanged, forgetExercises } from '../../app/current-exercise.ts';
import { formatTime } from '../../app/format.ts';
import { useSession } from '../../app/session.tsx';
import { useTrainingGate } from '../../app/use-training.ts';
import { t } from '../../app/i18n.ts';
import { Rich } from '../../app/rich-text.tsx';
import { exerciseTitle } from '../exercise/use-exercise-where.ts';

export function hasHistory(exercise: Exercise): boolean {
  return exercise.attemptCount > 0 || exercise.referenceCount > 0;
}

export function historyText(exercise: Exercise): string {
  return hasHistory(exercise)
    ? t('exercises.history', { attempts: t('common.count.attempt', { count: exercise.attemptCount }), references: t('common.count.reference', { count: exercise.referenceCount }) })
    : t('exercises.history-none');
}

function catalogueText(exercises: Exercise[]): string {
  if (exercises.every(exercise => exercise.catalogueId === null)) return t('exercises.delete.no-undo');
  return exercises.length === 1 ? t('exercises.delete.entry-stays') : t('exercises.delete.entries-stay');
}

function OneExercise({ exercise }: { exercise: Exercise }) {
  if (!hasHistory(exercise)) return <p>{t('exercises.delete.nothing')}</p>;
  return (
    <>
      <p>{t('exercises.delete.goes')}</p>
      <ul>
        {exercise.attemptCount > 0 ? (
          <li>
            <Rich k="exercises.delete.attempts" params={{ count: exercise.attemptCount }} parts={{ attempts: <b>{t('common.count.attempt', { count: exercise.attemptCount })}</b> }} />
          </li>
        ) : null}
        {exercise.referenceCount > 0 ? (
          <li>
            {exercise.activeReferenceId ? (
              <Rich k="exercises.delete.references-active" params={{ count: exercise.referenceCount }} parts={{ references: <b>{t('common.count.reference', { count: exercise.referenceCount })}</b> }} />
            ) : (
              <b>{t('common.count.reference', { count: exercise.referenceCount })}</b>
            )}
          </li>
        ) : null}
        {exercise.bestMs !== null ? (
          <li>
            <Rich k="exercises.delete.best" parts={{ time: <b>{formatTime(exercise.bestMs)}</b> }} />
          </li>
        ) : null}
      </ul>
    </>
  );
}

function SeveralExercises({ exercises }: { exercises: Exercise[] }) {
  const attempts = exercises.reduce((total, exercise) => total + exercise.attemptCount, 0);
  const references = exercises.reduce((total, exercise) => total + exercise.referenceCount, 0);
  return (
    <>
      <ul>
        {exercises.map(exercise => (
          <li key={exercise.id}>
            <b>{exerciseTitle(exercise).title}</b>, {historyText(exercise)}
          </li>
        ))}
      </ul>
      {attempts + references > 0 ? (
        <p>
          <Rich
            k="exercises.delete.with-them"
            params={{ count: attempts }}
            parts={{ attempts: <b>{t('common.count.attempt', { count: attempts })}</b>, references: <b>{t('common.count.reference', { count: references })}</b> }}
          />
        </p>
      ) : null}
    </>
  );
}

type DeleteExercisesDialogProps = {
  exercises: Exercise[];
  currentId: string | null;
  onKeep(): void;
  onDeleted(): void;
};

export function DeleteExercisesDialog({ exercises, currentId, onKeep, onDeleted }: DeleteExercisesDialogProps) {
  const { user } = useSession();
  const [cleanup, setCleanup] = useState(true);
  const [working, setWorking] = useState(false);
  const gate = useTrainingGate('delete');
  const [error, setError] = useState<string | null>(null);
  const withHistory = exercises.some(hasHistory);
  const one = exercises.length === 1;
  const current = exercises.find(exercise => exercise.id === currentId);

  const confirm = async () => {
    const ids = exercises.map(exercise => exercise.id);
    setWorking(true);
    setError(null);
    try {
      await gate.before();
      await api.removeExercises({ ids, cleanup: withHistory && cleanup });
      forgetExercises(user.id, ids);
      announceExercisesChanged();
      onDeleted();
    } catch (failure) {
      setError(deletionErrorText(failure));
      setWorking(false);
    }
  };

  return (
    <ConfirmDialog
      title={one ? t('exercises.delete.title-one', { name: exerciseTitle(exercises[0]!).title }) : t('exercises.delete.title-many', { count: exercises.length })}
      keepLabel={one ? t('exercises.delete.keep-it') : t('exercises.delete.keep-them')}
      confirmLabel={gate.label(one ? t('exercises.delete.confirm-one') : t('exercises.delete.confirm-many', { count: exercises.length }))}
      working={working}
      confirmDisabled={gate.blocked}
      notice={gate.notice}
      error={error}
      onKeep={onKeep}
      onConfirm={confirm}
    >
      {one ? <OneExercise exercise={exercises[0]!} /> : <SeveralExercises exercises={exercises} />}
      {current ? <p>{t('exercises.delete.current', { name: exerciseTitle(current).title })}</p> : null}
      <p>{catalogueText(exercises)}</p>
      {withHistory ? (
        <label className="confirm-check">
          <input type="checkbox" checked={cleanup} onChange={event => setCleanup(event.target.checked)} />
          {t('exercises.delete.cleanup')}
        </label>
      ) : null}
    </ConfirmDialog>
  );
}
