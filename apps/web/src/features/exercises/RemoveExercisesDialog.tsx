import { useState } from 'react';
import { medalSchema, type Exercise } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { deletionErrorText } from '../../app/busy.ts';
import { ConfirmDialog } from '../../app/ConfirmDialog.tsx';
import { announceExercisesChanged, forgetExercises } from '../../app/current-exercise.ts';
import { formatTime } from '../../app/format.ts';
import { counted, theirs } from '../../app/plural.ts';
import { useSession } from '../../app/session.tsx';

const MEDALS = new Set<string>(medalSchema.options);

function hasHistory(exercise: Exercise): boolean {
  return exercise.attemptCount > 0 || exercise.referenceCount > 0;
}

export function historyText(exercise: Exercise): string {
  return hasHistory(exercise) ? `${counted(exercise.attemptCount, 'attempt')}, ${counted(exercise.referenceCount, 'reference')}` : 'no attempts, no reference';
}

function catalogueText(exercises: Exercise[]): string {
  if (exercises.every(exercise => exercise.catalogueId === null)) return 'You cannot undo the removal.';
  return exercises.length === 1
    ? 'The catalogue entry stays. You can add the exercise again from Add exercise. You cannot undo the removal.'
    : 'The catalogue entries stay. You can add the exercises again from Add exercise. You cannot undo the removal.';
}

function OneExercise({ exercise }: { exercise: Exercise }) {
  if (!hasHistory(exercise)) return <p>It has no attempts and no reference yet.</p>;
  return (
    <>
      <p>The exercise goes, with everything recorded for it:</p>
      <ul>
        {exercise.attemptCount > 0 ? (
          <li>
            <b>{counted(exercise.attemptCount, 'attempt')}</b>, with {theirs(exercise.attemptCount)} cues and differences
          </li>
        ) : null}
        {exercise.referenceCount > 0 ? (
          <li>
            <b>{counted(exercise.referenceCount, 'reference')}</b>
            {exercise.activeReferenceId ? ', the active one too' : ''}
          </li>
        ) : null}
        {exercise.bestMs !== null ? (
          <li>
            your best time <b>{formatTime(exercise.bestMs)}</b>
            {MEDALS.has(exercise.status) ? ` and the ${exercise.status} medal` : ''}
          </li>
        ) : null}
      </ul>
    </>
  );
}

function SeveralExercises({ exercises, currentId }: { exercises: Exercise[]; currentId: string | null }) {
  const attempts = exercises.reduce((total, exercise) => total + exercise.attemptCount, 0);
  const references = exercises.reduce((total, exercise) => total + exercise.referenceCount, 0);
  const current = exercises.find(exercise => exercise.id === currentId);
  return (
    <>
      <ul>
        {exercises.map(exercise => (
          <li key={exercise.id}>
            <b>{exercise.name}</b>, {historyText(exercise)}
          </li>
        ))}
      </ul>
      {attempts + references > 0 ? (
        <p>
          With them go <b>{counted(attempts, 'attempt')}</b> with {theirs(attempts)} cues and differences, and <b>{counted(references, 'reference')}</b>.
        </p>
      ) : null}
      {current ? <p>{current.name} is your current exercise. The Drive button and Continue move to another exercise.</p> : null}
    </>
  );
}

type RemoveExercisesDialogProps = {
  exercises: Exercise[];
  fromPage: boolean;
  currentId: string | null;
  onKeep(): void;
  onRemoved(): void;
};

export function RemoveExercisesDialog({ exercises, fromPage, currentId, onKeep, onRemoved }: RemoveExercisesDialogProps) {
  const { user } = useSession();
  const [cleanup, setCleanup] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const withHistory = exercises.some(hasHistory);
  const one = exercises.length === 1;
  const single = fromPage && one;

  const confirm = async () => {
    const ids = exercises.map(exercise => exercise.id);
    setWorking(true);
    setError(null);
    try {
      await api.removeExercises({ ids, cleanup: withHistory && cleanup });
      forgetExercises(user.id, ids);
      announceExercisesChanged();
      onRemoved();
    } catch (failure) {
      setError(deletionErrorText(failure));
      setWorking(false);
    }
  };

  return (
    <ConfirmDialog
      title={single ? `Remove ${exercises[0]!.name}?` : `Remove ${counted(exercises.length, 'exercise')}?`}
      keepLabel={one ? 'Keep it' : 'Keep them'}
      confirmLabel={single ? 'Remove exercise' : `Remove ${counted(exercises.length, 'exercise')}`}
      working={working}
      error={error}
      onKeep={onKeep}
      onConfirm={confirm}
    >
      {single ? <OneExercise exercise={exercises[0]!} /> : <SeveralExercises exercises={exercises} currentId={currentId} />}
      <p>{catalogueText(exercises)}</p>
      {withHistory ? (
        <label className="confirm-check">
          <input type="checkbox" checked={cleanup} onChange={event => setCleanup(event.target.checked)} />
          Also clean up the raw captures that nothing uses afterwards
        </label>
      ) : null}
    </ConfirmDialog>
  );
}
