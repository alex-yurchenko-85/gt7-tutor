import type { CornerInfo, Exercise, ExerciseStep, ReferenceCue, ReferenceTrace } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { cornerMarks } from '../../charts/corner-marks.ts';
import { TrackMap } from '../../charts/TrackMap.tsx';
import { currentExercise } from '../../app/current-exercise.ts';
import { formatTime } from '../../app/format.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths } from '../../app/router.tsx';
import { useSession } from '../../app/session.tsx';
import { ExerciseHeader } from '../exercise/ExerciseHeader.tsx';
import './now.css';

type StepInfo = { number: ExerciseStep; title: string; detail(exercise: Exercise): string };

const BASELINE_TARGET = 3;

const STEPS: StepInfo[] = [
  { number: 1, title: 'Record the reference', detail: exercise => (exercise.activeReferenceId ? 'Reference recorded' : 'Three demonstration recordings') },
  { number: 2, title: 'Baseline attempts without voice', detail: () => `Drive ${BASELINE_TARGET} attempts so the differences show. You can skip this.` },
  { number: 3, title: 'Guided attempts with voice', detail: () => 'The voice gives the cues of the reference.' },
  { number: 4, title: 'Review', detail: exercise => `${exercise.completeAttempts} complete attempts` }
];

type Action = { label: string; to: string };

function primaryAction(exercise: Exercise): Action {
  switch (exercise.step) {
    case 1:
      return { label: 'Record the reference', to: paths.record(exercise.id) };
    case 2:
      return { label: 'Start a baseline attempt', to: `${paths.drive()}?mode=baseline` };
    case 3:
      return { label: 'Start a guided attempt', to: `${paths.drive()}?mode=guided` };
    case 4:
      return { label: 'Open the attempts', to: paths.attempts(exercise.id) };
  }
}

function secondaryActions(exercise: Exercise): Action[] {
  if (!exercise.activeReferenceId) return [{ label: 'Select another exercise', to: paths.catalogue() }];
  const actions: Action[] = [];
  if (exercise.step !== 3) actions.push({ label: 'Start a guided attempt', to: `${paths.drive()}?mode=guided` });
  if (exercise.step === 3 || exercise.step === 4) actions.push({ label: 'Start a baseline attempt', to: `${paths.drive()}?mode=baseline` });
  actions.push({ label: 'See what the voice will say', to: paths.cues(exercise.id) });
  if (exercise.step !== 4 && exercise.completeAttempts > 0) actions.push({ label: 'Open the attempts', to: paths.attempts(exercise.id) });
  actions.push({ label: 'Select another exercise', to: paths.catalogue() });
  return actions.slice(0, 4);
}

function stepState(step: ExerciseStep, current: ExerciseStep): 'done' | 'now' | 'later' {
  if (step < current) return 'done';
  return step === current ? 'now' : 'later';
}

function ReferenceMap({ referenceId }: { referenceId: string }) {
  const data = useResource(
    () => Promise.all([api.referenceTrace(referenceId), api.referenceCues(referenceId), api.referenceCorners(referenceId)]),
    [referenceId]
  );
  if (!data.data) return data.error ? <p className="sub">{errorText(data.error)}</p> : null;
  const [trace, cues, corners]: [ReferenceTrace, ReferenceCue[], CornerInfo[]] = data.data;
  return (
    <>
      <div className="stats">
        <div>
          <b>{formatTime(trace.timeMs)}</b>reference, measured
        </div>
        <div>
          <b>{Math.round(trace.lengthM)} m</b>section length
        </div>
        <div>
          <b>{cues.filter(cue => !cue.muted && cue.phrase).length}</b>voice cues
        </div>
      </div>
      <div className="plot">
        <TrackMap
          label="Reference line with the voice cues and the turns"
          reference={trace}
          marks={[
            ...cornerMarks(corners),
            ...cues.map((cue, index) => ({ sM: cue.sM, label: String(index + 1), muted: cue.muted, title: `Cue ${index + 1}: ${cue.phrase ?? cue.kind}` }))
          ]}
        />
      </div>
      <div className="legend">
        <span>
          <i className="ref" />
          reference line
        </span>
        <span>Numbers mark the voice cues</span>
        <span>
          <i className="apex" />
          apex, T1 is turn 1
        </span>
        <span>Map orientation is not confirmed</span>
      </div>
    </>
  );
}

function ExerciseNow({ exercise }: { exercise: Exercise }) {
  const primary = primaryAction(exercise);
  return (
    <>
      <ExerciseHeader exercise={exercise} />
      <div className="cols">
        <div className="panel">
          <p className="sub">Follow the four steps. The highlighted step is where you are.</p>
          <ol className="steps">
            {STEPS.map(step => {
              const state = stepState(step.number, exercise.step);
              return (
                <li key={step.number} className={`step ${state}`} aria-current={state === 'now' ? 'step' : undefined}>
                  <i aria-hidden="true">{step.number}</i>
                  <div>
                    {step.title}
                    <small>{step.detail(exercise)}</small>
                  </div>
                  <span className="step-state">{state === 'done' ? 'done' : state === 'now' ? 'now' : ''}</span>
                </li>
              );
            })}
          </ol>
          <Link to={primary.to} className="btn" primary>
            {primary.label}
          </Link>
          {secondaryActions(exercise).map(action => (
            <Link key={action.label} to={action.to} className="btn ghost">
              {action.label}
            </Link>
          ))}
        </div>
        <div>
          {exercise.bestMs !== null ? (
            <p className="best">
              Your best: <b>{formatTime(exercise.bestMs)}</b> <span className="sub">measured from telemetry</span>
            </p>
          ) : null}
          {exercise.activeReferenceId ? (
            <ReferenceMap referenceId={exercise.activeReferenceId} />
          ) : (
            <div className="panel">
              <h2>No reference yet</h2>
              <p className="lede">
                The reference is the demonstration that the game shows before the exercise. GT7 Tutor records it three times, finds the part that
                repeats, and uses it as the target for the voice cues.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function NowView() {
  const { user } = useSession();
  const exercises = useResource(() => api.exercises(), []);
  if (exercises.error) return <p className="error">{errorText(exercises.error)}</p>;
  if (!exercises.data) return <p className="sub">Reading your exercises…</p>;
  const exercise = currentExercise(exercises.data, user.id);
  if (!exercise) {
    return (
      <section className="panel now-empty">
        <h1>Start with an exercise</h1>
        <p className="lede">Select a licence test, a Circuit Experience sector or another exercise in the catalogue. GT7 Tutor then leads you through four steps.</p>
        <Link to={paths.catalogue()} className="btn inline">
          Select an exercise
        </Link>
      </section>
    );
  }
  return <ExerciseNow exercise={exercise} />;
}
