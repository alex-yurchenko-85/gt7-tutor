import { useEffect, useState } from 'react';
import { type CornerInfo, type Exercise, type ExerciseStep, type RecurringDifference, type ReferenceCue, type ReferenceTrace } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { cornerMarks } from '../../charts/corner-marks.ts';
import { MapDialog } from '../../charts/MapDialog.tsx';
import { TrackMap } from '../../charts/TrackMap.tsx';
import { rememberExercise } from '../../app/current-exercise.ts';
import { DangerRow } from '../../app/DangerRow.tsx';
import { formatTime, signedSeconds } from '../../app/format.ts';
import { Icon } from '../../app/icons.tsx';
import { LoadProblem } from '../../app/NotFound.tsx';
import { errorText, useResource } from '../../app/resource.ts';
import { counted } from '../../app/plural.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { useSession } from '../../app/session.tsx';
import { differenceName, sizeText } from '../cues/cue-format.ts';
import { primaryAction, STEP_LABELS, type Action } from '../exercises/next-step.ts';
import { RemoveExercisesDialog } from '../exercises/RemoveExercisesDialog.tsx';
import { spokenCues } from '../drive/cue-display.ts';
import { ExerciseHeader } from './ExerciseHeader.tsx';
import { useExercise } from './use-exercise.ts';
import './overview.css';

const SHOWN_RECURRING = 3;

type ReferenceData = { trace: ReferenceTrace; cues: ReferenceCue[]; corners: CornerInfo[] };

type NextText = { title: string; detail(spokenCues: number | null): string };

const NEXT: Record<ExerciseStep, NextText> = {
  1: {
    title: 'Next: record the reference',
    detail: () => 'The reference is the demonstration that the game shows before the exercise. GT7 Tutor records it once.'
  },
  2: {
    title: 'Next: drive attempts',
    detail: spoken =>
      `The Drive screen shows the ${spoken === null ? '' : `${spoken} `}cues of the reference. A voice device also says them. After 3 complete attempts, review them.`
  },
  3: {
    title: 'Next: review your attempts',
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

function stepNote(step: ExerciseStep, current: ExerciseStep): string {
  if (step < current) return 'done';
  if (step === current) return 'now';
  return step === current + 1 ? 'next' : '';
}

function NextPanel({ exercise, reference }: { exercise: Exercise; reference: ReferenceData | null }) {
  const primary = primaryAction(exercise);
  const next = NEXT[exercise.step];
  return (
    <section className="panel overview-next" aria-labelledby="next-title">
      <ol className="compact-rail" aria-label="Three steps">
        {STEP_LABELS.map(({ step, label }) => {
          const note = stepNote(step, exercise.step);
          return (
            <li key={step} className={note || 'later'} aria-current={note === 'now' ? 'step' : undefined}>
              <b>{label}</b>
              <span className="step-note">{note}</span>
              <span className="step-number" aria-hidden="true">
                {step}
              </span>
            </li>
          );
        })}
      </ol>
      <h2 id="next-title">{next.title}</h2>
      <p className="lede">{next.detail(reference ? spokenCues(reference.cues).length : null)}</p>
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

function TimesPanel({ bestMs, referenceMs }: { bestMs: number | null; referenceMs: number | null }) {
  if (bestMs === null && referenceMs === null) return null;
  return (
    <section className="panel overview-times" aria-labelledby="times-title">
      <h2 id="times-title">Times from the game</h2>
      <div className="times-row">
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
    </section>
  );
}

function recurringLine(item: RecurringDifference): string {
  return `${differenceName(item.kind)}, median ${sizeText(item.medianSize, item.unit)}`;
}

function WorkFirst({ exerciseId }: { exerciseId: string }) {
  const recurring = useResource(() => api.recurring(exerciseId), [exerciseId]);
  const items = recurring.data ?? [];
  if (items.length === 0) return null;
  return (
    <section className="panel overview-work" aria-labelledby="work-title">
      <div className="panel-head">
        <h2 id="work-title">Work on these first</h2>
        <Link to={paths.attempts(exerciseId)} className="text-link">
          All {items.length} differences
        </Link>
      </div>
      <p className="sub">Differences that repeat in your last {items[0]!.of} complete attempts.</p>
      <ul className="work-list">
        {items.slice(0, SHOWN_RECURRING).map(item => (
          <li key={`${item.kind}-${item.eventKey ?? item.sM}`}>
            <span className="turn-badge">{item.turn === null ? '—' : `T${item.turn}`}</span>
            <span>{recurringLine(item)}</span>
            <span className="sub">
              {item.count} of {item.of}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MapPanel({ title, reference }: { title: string; reference: ReferenceData }) {
  const [open, setOpen] = useState(false);
  const { trace, cues, corners } = reference;
  const spoken = spokenCues(cues).length;
  return (
    <section className="panel overview-map" aria-labelledby="map-title">
      <div className="panel-head">
        <h2 id="map-title">
          Reference line, {Math.round(trace.lengthM)} m, {spoken} cues
        </h2>
        <button type="button" className="icon-button" aria-label="View the map in full screen" onClick={() => setOpen(true)}>
          <Icon name="expand" size={16} />
          View
        </button>
      </div>
      <TrackMap
        label="Reference line with the voice cues and the turns"
        reference={trace}
        marks={[
          ...cornerMarks(corners),
          ...cues.map((cue, index) => ({ sM: cue.sM, label: String(index + 1), muted: cue.muted, title: `Cue ${index + 1}: ${cue.phrase ?? cue.kind}` }))
        ]}
      />
      <div className="legend">
        <span>
          <i className="ref" />
          reference line
        </span>
        {cues.length > 0 ? <span>1–{cues.length} voice cues</span> : null}
        {corners.length > 0 ? <span>T1–T{corners.length} turns</span> : null}
        <span>Map orientation is not confirmed</span>
      </div>
      <MapDialog open={open} onClose={() => setOpen(false)} title={title} trace={trace} cues={cues} corners={corners} />
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

function useReference(referenceId: string | null) {
  return useResource<ReferenceData | null>(
    () =>
      referenceId === null
        ? Promise.resolve(null)
        : Promise.all([api.referenceTrace(referenceId), api.referenceCues(referenceId), api.referenceCorners(referenceId)]).then(([trace, cues, corners]) => ({
            trace,
            cues,
            corners
          })),
    [referenceId]
  );
}

function RemoveThisExercise({ exercise }: { exercise: Exercise }) {
  const { navigate } = useRouter();
  const [confirming, setConfirming] = useState(false);
  const hint =
    exercise.attemptCount > 0 || exercise.referenceCount > 0
      ? `Removes the exercise with its ${counted(exercise.attemptCount, 'attempt')} and ${counted(exercise.referenceCount, 'reference')}.`
      : 'Removes the exercise from My exercises.';
  return (
    <>
      <DangerRow title="Remove this exercise" hint={hint} action="Remove exercise…" onAction={() => setConfirming(true)} />
      {confirming ? (
        <RemoveExercisesDialog exercises={[exercise]} fromPage currentId={exercise.id} onKeep={() => setConfirming(false)} onRemoved={() => navigate(paths.exercises())} />
      ) : null}
    </>
  );
}

function Overview({ exercise }: { exercise: Exercise }) {
  const reference = useReference(exercise.activeReferenceId);
  const data = reference.data ?? null;
  return (
    <>
      <ExerciseHeader exercise={exercise} />
      <div className="overview-columns">
        <div className="overview-stack">
          <NextPanel exercise={exercise} reference={data} />
          <TimesPanel bestMs={exercise.bestMs} referenceMs={data?.trace.timeMs ?? null} />
          <WorkFirst exerciseId={exercise.id} />
        </div>
        {exercise.activeReferenceId === null ? (
          <NoReference />
        ) : data ? (
          <MapPanel title={exercise.name} reference={data} />
        ) : reference.error ? (
          <p className="sub">{errorText(reference.error)}</p>
        ) : null}
      </div>
      <RemoveThisExercise exercise={exercise} />
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
