import { useState } from 'react';
import type { ReferenceInfo } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { deletionErrorText } from '../../app/busy.ts';
import { ConfirmDialog } from '../../app/ConfirmDialog.tsx';
import { formatDay } from '../../app/format.ts';
import { LoadProblem } from '../../app/NotFound.tsx';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { useTrainingGate } from '../../app/use-training.ts';
import { ExerciseHeader } from '../exercise/ExerciseHeader.tsx';
import { useExercise } from '../exercise/use-exercise.ts';
import { t } from '../../app/i18n.ts';

function originName(reference: ReferenceInfo): string {
  return reference.origin === 'demo' ? t('exercises.references.demo') : t('exercises.references.own');
}

function meta(reference: ReferenceInfo): string {
  const version = reference.gameVersion ? t('exercises.references.version', { version: reference.gameVersion }) : t('exercises.references.no-version');
  return t('exercises.references.meta', { date: formatDay(reference.createdAt), version, first: reference.first, last: reference.last, count: reference.attemptCount });
}

type RowProps = { reference: ReferenceInfo; onActivate(): void; onCheck(): void; onDelete(): void };

function ReferenceRow({ reference, onActivate, onCheck, onDelete }: RowProps) {
  return (
    <tr>
      <td>
        <b className="reference-name">{originName(reference)}</b>{' '}
        {reference.active ? <span className="tag y">{t('exercises.references.active')}</span> : null} {reference.needsCheck ? <span className="tag bad">{t('exercises.references.needs-check')}</span> : null}
        <br />
        <span className="sub">{meta(reference)}</span>
      </td>
      <td>
        <div className="btn-row">
          {reference.active ? null : (
            <button className="btn inline ghost" type="button" onClick={onActivate}>
              {reference.origin === 'demo' ? t('exercises.references.return') : t('exercises.references.make-active')}
            </button>
          )}
          {reference.needsCheck ? (
            <button className="btn inline" type="button" onClick={onCheck}>
              {t('exercises.references.check')}
            </button>
          ) : null}
          {reference.attemptCount === 0 && !reference.active ? (
            <button className="btn inline danger" type="button" onClick={onDelete}>
              {t('common.delete')}
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function DeleteReferenceDialog({ reference, onKeep, onDeleted }: { reference: ReferenceInfo; onKeep(): void; onDeleted(): void }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gate = useTrainingGate('delete');
  const confirm = async () => {
    setWorking(true);
    setError(null);
    try {
      await gate.before();
      await api.deleteReference(reference.id);
      onDeleted();
    } catch (failure) {
      setError(deletionErrorText(failure));
      setWorking(false);
    }
  };
  return (
    <ConfirmDialog
      title={t('exercises.references.delete-title')}
      keepLabel={t('exercises.references.keep')}
      confirmLabel={gate.label(t('exercises.references.delete-confirm'))}
      working={working}
      confirmDisabled={gate.blocked}
      notice={gate.notice}
      error={error}
      onKeep={onKeep}
      onConfirm={confirm}
    >
      <p>
        {t('exercises.references.delete-what', { name: originName(reference), date: formatDay(reference.createdAt) })}
      </p>
      <ul>
        <li>{t('exercises.references.active-stays')}</li>
        <li>{t('exercises.references.no-undo')}</li>
      </ul>
    </ConfirmDialog>
  );
}

export function ReferencesView({ exerciseId }: { exerciseId: string }) {
  const exercise = useExercise(exerciseId);
  const references = useResource(() => api.references(exerciseId), [exerciseId]);
  const { navigate } = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ReferenceInfo | null>(null);

  const act = async (action: () => Promise<unknown>) => {
    setProblem(null);
    try {
      await action();
      references.reload();
      exercise.reload();
    } catch (error) {
      setProblem(errorText(error));
    }
  };

  if (exercise.error) return <LoadProblem error={exercise.error} kind="exercise" />;
  if (!exercise.data) return <p className="sub">{t('exercises.reading-exercise')}</p>;
  const list = [...(references.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section>
      <ExerciseHeader exercise={exercise.data} title={t('exercises.references.title')} />
      <p className="lede">{t('exercises.references.text')}</p>
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
      {list.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('exercises.references.column')}</th>
                <th>{t('exercises.references.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map(reference => (
                <ReferenceRow
                  key={reference.id}
                  reference={reference}
                  onActivate={() => void act(() => api.activateReference(reference.id))}
                  onCheck={() => navigate(`${paths.record(exerciseId)}?check=${encodeURIComponent(reference.id)}`)}
                  onDelete={() => setDeleting(reference)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : references.data ? (
        <p className="sub">{t('exercises.references.none')}</p>
      ) : null}
      <Link to={paths.record(exerciseId)} className="btn inline ghost" >
        {t('exercises.references.record')}
      </Link>
      <p className="sub" style={{ marginTop: 10 }}>
        {t('exercises.references.help')}
      </p>
      {deleting ? (
        <DeleteReferenceDialog
          reference={deleting}
          onKeep={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            references.reload();
            exercise.reload();
          }}
        />
      ) : null}
    </section>
  );
}
