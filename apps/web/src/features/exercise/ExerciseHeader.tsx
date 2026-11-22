import { useEffect } from 'react';
import type { Exercise } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { rememberExercise } from '../../app/current-exercise.ts';
import { formatTime, signedSecondsText } from '../../app/format.ts';
import { useResource } from '../../app/resource.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { useSession } from '../../app/session.tsx';
import { useExerciseWhere } from './use-exercise-where.ts';
import './exercise.css';
import './times.css';
import { t } from '../../app/i18n.ts';

type Tab = 'cues' | 'references' | 'attempts';

const TABS = [
  { name: 'cues', label: 'exercises.tab.cues', to: (id: string) => paths.cues(id) },
  { name: 'references', label: 'exercises.tab.references', to: (id: string) => paths.references(id) },
  { name: 'attempts', label: 'exercises.tab.attempts', to: (id: string) => paths.attempts(id) }
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
    <div className="exercise-times">
      {bestMs !== null ? (
        <div>
          <b>{formatTime(bestMs)}</b>
          <span>{t('exercises.times.best')}</span>
        </div>
      ) : null}
      {referenceMs !== null ? (
        <div className="reference-time">
          <b>{formatTime(referenceMs)}</b>
          <span>{t('exercises.times.reference')}</span>
        </div>
      ) : null}
      {bestMs !== null && referenceMs !== null ? (
        <div className={bestMs > referenceMs ? 'gap-slower' : 'gap-faster'}>
          <b>{signedSecondsText(bestMs - referenceMs)}</b>
          <span>{t('exercises.times.gap')}</span>
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
        <nav className="breadcrumb">
          <Link to={paths.exercises()}>{t('exercises.breadcrumb.exercises')}</Link> / {exercise.name}
        </nav>
        <h1>{exercise.name}</h1>
        <p className="exercise-where sub">{where}</p>
        <TimesBand exercise={exercise} />
        <nav className="exercise-tabs">
          {TABS.map(tab => (
            <Link key={tab.name} to={tab.to(exercise.id)} current={active === tab.name}>
              {t(tab.label)}
            </Link>
          ))}
        </nav>
      </header>
      {title ? <h2 className="section-title">{title}</h2> : null}
    </>
  );
}
