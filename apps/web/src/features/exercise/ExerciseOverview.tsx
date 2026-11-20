import { useEffect } from 'react';
import type { Exercise, ExerciseStep } from '@gt7/contracts';
import { rememberExercise } from '../../app/current-exercise.ts';
import { signedSeconds } from '../../app/format.ts';
import { LoadProblem } from '../../app/NotFound.tsx';
import { errorText } from '../../app/resource.ts';
import { counted } from '../../app/plural.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { useSession } from '../../app/session.tsx';
import { RecurringDifferences } from '../attempts/RecurringDifferences.tsx';
import { nextTitle, primaryAction, type Action } from '../exercises/next-step.ts';
import { type ReferenceData, useReferenceData } from '../drive/use-reference-data.ts';
import { ExerciseHeader } from './ExerciseHeader.tsx';
import { ReferenceMap } from './ReferenceMap.tsx';
import { TimesPanel } from './TimesPanel.tsx';
import { useExercise } from './use-exercise.ts';
import './overview.css';

type NextText = { title: string; detail(spokenCues: number | null): string };

const NEXT: Record<ExerciseStep, NextText> = {
  1: {
    title: nextTitle(1),
    detail: () => 'The reference is the demonstration that the game shows before the exercise. GT7 Tutor records it once.'
  },
  2: {
    title: nextTitle(2),
    detail: spoken =>
      `The Drive screen shows the ${spoken === null ? 'cues' : counted(spoken, 'cue')} of the reference. A voice device also says them. After 3 complete attempts, review them.`
  },
  3: {
    title: nextTitle(3),
    detail: () => 'Compare your attempts with the reference and find the differences that repeat.'
  }
};

function secondaryActions(exercise: Exercise): Action[] {
  switch (exercise.step) {
    case 1:
      return [{ label: 'Choose another exercise', to: paths.addExercise() }];
    case 2:
      return [{ label: 'Hear the cues first', to: paths.cues(exercise.id) }];
    case 3:
      return [{ label: 'Start an attempt', to: paths.drive() }];
  }
}

function NextPanel({ exercise, reference }: { exercise: Exercise; reference: ReferenceData | null }) {
  const primary = primaryAction(exercise);
  const next = NEXT[exercise.step];
  return (
    <section className="panel overview-next" aria-labelledby="next-title">
      <h2 id="next-title">{next.title}</h2>
      <p className="lede">{next.detail(reference ? reference.spoken.length : null)}</p>
      <Link to={primary.to} className="btn" primary>
        {primary.label}
      </Link>
      <div className="text-links">
        {secondaryActions(exercise).map(action => (
          <Link key={action.label} to={action.to} className="text-link">
            {action.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

function NoReference() {
  return (
    <section className="panel" aria-labelledby="no-reference-title">
      <h2 id="no-reference-title">No reference yet</h2>
      <p className="lede">
        The reference is the demonstration that the game shows before the exercise. GT7 Tutor records it once.
      </p>
    </section>
  );
}

function Overview({ exercise }: { exercise: Exercise }) {
  const reference = useReferenceData(exercise.activeReferenceId);
  const data = reference.data ?? null;
  const referenceMs = data?.trace.timeMs ?? null;
  return (
    <>
      <ExerciseHeader exercise={exercise} />
      <div className="overview-columns">
        <div className="overview-stack">
          <NextPanel exercise={exercise} reference={data} />
          <TimesPanel bestMs={exercise.bestMs} referenceMs={referenceMs}>
            {exercise.bestMs !== null && referenceMs !== null ? (
              <div className={exercise.bestMs > referenceMs ? 'gap-slower' : 'gap-faster'}>
                <b>{signedSeconds(exercise.bestMs - referenceMs)} s</b>
                <span>gap to the reference</span>
              </div>
            ) : null}
          </TimesPanel>
          <RecurringDifferences exercise={exercise} quiet />
        </div>
        {exercise.activeReferenceId === null ? (
          <NoReference />
        ) : data ? (
          <ReferenceMap title={exercise.name} reference={data} />
        ) : reference.error ? (
          <p className="sub">{errorText(reference.error)}</p>
        ) : null}
      </div>
    </>
  );
}

export function ExerciseOverview({ exerciseId }: { exerciseId: string }) {
  const { user } = useSession();
  const exercise = useExercise(exerciseId);
  useEffect(() => {
    if (exercise.data) rememberExercise(user.id, exercise.data.id);
  }, [exercise.data, user.id]);
  if (exercise.error) return <LoadProblem error={exercise.error} kind="exercise" />;
  if (!exercise.data) return <p className="sub">Reading the exercise…</p>;
  return <Overview exercise={exercise.data} />;
}
