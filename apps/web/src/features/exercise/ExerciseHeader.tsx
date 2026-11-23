import { useEffect, useState } from 'react';
import type { Exercise } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { rememberExercise } from '../../app/current-exercise.ts';
import { formatTime, signedSecondsText } from '../../app/format.ts';
import { useResource } from '../../app/resource.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { useSession } from '../../app/session.tsx';
import { hasHistory } from '../exercises/DeleteExercisesDialog.tsx';
import { TargetTime } from './TargetTime.tsx';
import { exerciseTitle, useExerciseWhere } from './use-exercise-where.ts';
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

function gapClass(gapMs: number): string {
  return gapMs > 0 ? 'gap-slower' : 'gap-faster';
}

function TimesBand({ exercise, onSaved }: { exercise: Exercise; onSaved(next: Exercise): void }) {
  const referenceMs = useReferenceMs(exercise.activeReferenceId);
  const { bestMs, targetMs } = exercise;
  return (
    <div className="exercise-times">
      {bestMs !== null ? (
        <div>
          <b>{formatTime(bestMs)}</b>
          <span>{t('exercises.times.best')}</span>
        </div>
      ) : null}
      <TargetTime exercise={exercise} onSaved={onSaved} />
      {bestMs !== null && targetMs !== null ? (
        <div className={gapClass(bestMs - targetMs)}>
          <b>{signedSecondsText(bestMs - targetMs)}</b>
          <span>{t('exercises.times.target-gap')}</span>
        </div>
      ) : null}
      {referenceMs !== null ? (
        <div className="reference-time">
          <b>{formatTime(referenceMs)}</b>
          <span>{t('exercises.times.reference')}</span>
        </div>
      ) : null}
      {bestMs !== null && referenceMs !== null ? (
        <div className={gapClass(bestMs - referenceMs)}>
          <b>{signedSecondsText(bestMs - referenceMs)}</b>
          <span>{t('exercises.times.gap')}</span>
        </div>
      ) : null}
    </div>
  );
}

export function ExerciseHeader({ exercise: loaded, title, current }: { exercise: Exercise; title?: string; current?: Tab }) {
  const [exercise, setExercise] = useState(loaded);
  useEffect(() => setExercise(loaded), [loaded]);
  const { route } = useRouter();
  const { user } = useSession();
  const where = useExerciseWhere(exercise);
  const { title: name } = exerciseTitle(exercise);
  const active = current ?? route.name;
  useEffect(() => rememberExercise(user.id, exercise.id), [user.id, exercise.id]);
  return (
    <>
      <header className="exercise-header">
        <nav className="breadcrumb">
          <Link to={paths.exercises()}>{t('exercises.breadcrumb.exercises')}</Link> / {name}
        </nav>
        <h1>{name}</h1>
        <p className="exercise-where sub">{where}</p>
        <TimesBand exercise={exercise} onSaved={setExercise} />
        {hasHistory(exercise) ? (
          <nav className="exercise-tabs">
            {TABS.map(tab => (
              <Link key={tab.name} to={tab.to(exercise.id)} current={active === tab.name}>
                {t(tab.label)}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>
      {title ? <h2 className="section-title">{title}</h2> : null}
    </>
  );
}
