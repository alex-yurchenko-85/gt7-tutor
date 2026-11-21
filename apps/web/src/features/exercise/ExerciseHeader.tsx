import { useEffect } from 'react';
import type { Exercise } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { rememberExercise } from '../../app/current-exercise.ts';
import { formatTime, signedSeconds } from '../../app/format.ts';
import { useResource } from '../../app/resource.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { useSession } from '../../app/session.tsx';
import { useExerciseWhere } from './use-exercise-where.ts';
import './exercise.css';
import './times.css';

type Tab = 'cues' | 'references' | 'attempts';

const TABS = [
  { name: 'cues', label: 'Cues', to: (id: string) => paths.cues(id) },
  { name: 'references', label: 'References', to: (id: string) => paths.references(id) },
  { name: 'attempts', label: 'Attempts', to: (id: string) => paths.attempts(id) }
] as const;

function useReferenceMs(referenceId: string | null): number | null {
  const trace = useResource(() => (referenceId ? api.referenceTrace(referenceId) : Promise.resolve(null)), [referenceId]);
  return trace.data?.timeMs ?? null;
}

function TimesBand({ exercise }: { exercise: Exercise }) {
  const referenceMs = useReferenceMs(exercise.activeReferenceId);
  const bestMs = exercise.bestMs;
  if (bestMs === null && referenceMs === null) return null;
  return (
    <div className="exercise-times" role="group" aria-label="Times from the game">
      {bestMs !== null ? (
        <div>
          <b>{formatTime(bestMs)}</b>
          <span>your best</span>
        </div>
      ) : null}
      {referenceMs !== null ? (
        <div className="reference-time">
          <b>{formatTime(referenceMs)}</b>
          <span>reference</span>
        </div>
      ) : null}
      {bestMs !== null && referenceMs !== null ? (
        <div className={bestMs > referenceMs ? 'gap-slower' : 'gap-faster'}>
          <b>{signedSeconds(bestMs - referenceMs)} s</b>
          <span>gap to the reference</span>
        </div>
      ) : null}
    </div>
  );
}

export function ExerciseHeader({ exercise, title, current }: { exercise: Exercise; title?: string; current?: Tab }) {
  const { route } = useRouter();
  const { user } = useSession();
  const where = useExerciseWhere(exercise);
  const active = current ?? route.name;
  useEffect(() => rememberExercise(user.id, exercise.id), [user.id, exercise.id]);
  return (
    <>
      <header className="exercise-header">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to={paths.exercises()}>Exercises</Link> / {exercise.name}
        </nav>
        <h1>{exercise.name}</h1>
        <p className="exercise-where sub">{where}</p>
        <TimesBand exercise={exercise} />
        <nav className="exercise-tabs" aria-label="Exercise">
          {TABS.map(tab => (
            <Link key={tab.name} to={tab.to(exercise.id)} current={active === tab.name}>
              {tab.label}
            </Link>
          ))}
        </nav>
      </header>
      {title ? <h2 className="section-title">{title}</h2> : null}
    </>
  );
}
