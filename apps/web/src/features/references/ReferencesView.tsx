import { useState } from 'react';
import type { ReferenceInfo } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { formatDay } from '../../app/format.ts';
import { LoadProblem } from '../../app/NotFound.tsx';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { ExerciseHeader } from '../exercise/ExerciseHeader.tsx';
import { useExercise } from '../exercise/use-exercise.ts';

function originName(reference: ReferenceInfo): string {
  return reference.origin === 'demo' ? 'Demonstration' : 'Your attempt';
}

function meta(reference: ReferenceInfo): string {
  const version = reference.gameVersion ? `game version ${reference.gameVersion}` : 'no game version';
  const start = reference.startKind === 'standing' ? 'standing start' : 'flying start';
  return `${formatDay(reference.createdAt)}, ${version}, ${start}. Frames ${reference.first}–${reference.last}. ${reference.attemptCount} attempts use it.`;
}

type RowProps = { reference: ReferenceInfo; onActivate(): void; onCheck(): void; onDelete(): void };

function ReferenceRow({ reference, onActivate, onCheck, onDelete }: RowProps) {
  const [confirming, setConfirming] = useState(false);
  return (
    <tr>
      <td>
        <b className="reference-name">{originName(reference)}</b>{' '}
        {reference.active ? <span className="tag y">active</span> : null} {reference.needsCheck ? <span className="tag bad">Needs a check</span> : null}
        <br />
        <span className="sub">{meta(reference)}</span>
      </td>
      <td>
        <div className="btn-row">
          {reference.active ? null : (
            <button className="btn inline ghost" type="button" onClick={onActivate}>
              {reference.origin === 'demo' ? 'Return to the demonstration' : 'Make active'}
            </button>
          )}
          {reference.needsCheck ? (
            <button className="btn inline" type="button" onClick={onCheck}>
              Check with one recording
            </button>
          ) : null}
          {reference.attemptCount === 0 && !reference.active ? (
            confirming ? (
              <>
                <button className="btn inline" type="button" onClick={onDelete}>
                  Delete reference
                </button>
                <button className="btn inline ghost" type="button" onClick={() => setConfirming(false)}>
                  Keep it
                </button>
              </>
            ) : (
              <button className="btn inline ghost" type="button" onClick={() => setConfirming(true)}>
                Delete
              </button>
            )
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export function ReferencesView({ exerciseId }: { exerciseId: string }) {
  const exercise = useExercise(exerciseId);
  const references = useResource(() => api.references(exerciseId), [exerciseId]);
  const { navigate } = useRouter();
  const [problem, setProblem] = useState<string | null>(null);

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
  if (!exercise.data) return <p className="sub">Reading the exercise…</p>;
  const list = [...(references.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section>
      <ExerciseHeader exercise={exercise.data} title="Reference history" />
      <p className="lede">
        A reference is never overwritten. A new one joins the history, and you can make any of them active. Each attempt remembers the reference it was
        driven against.
      </p>
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
      {list.length ? (
        <div className="table-wrap">
          <table aria-label="References">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map(reference => (
                <ReferenceRow
                  key={reference.id}
                  reference={reference}
                  onActivate={() => void act(() => api.activateReference(reference.id))}
                  onCheck={() => navigate(`${paths.record(exerciseId)}?check=${encodeURIComponent(reference.id)}`)}
                  onDelete={() => void act(() => api.deleteReference(reference.id))}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : references.data ? (
        <p className="sub">No reference yet.</p>
      ) : null}
      <Link to={paths.record(exerciseId)} className="btn inline ghost" >
        Record a new reference
      </Link>
      <p className="sub" style={{ marginTop: 10 }}>
        A complete attempt can become a reference from its review. A reference that attempts use cannot be deleted.
      </p>
    </section>
  );
}
