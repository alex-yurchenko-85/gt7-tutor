import { useEffect, useState } from 'react';
import { type CornerInfo, type Exercise, type ExerciseStep, type ReferenceCue, type ReferenceTrace } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { cornerMarks } from '../../charts/corner-marks.ts';
import { MapDialog, cueItems } from '../../charts/MapDialog.tsx';
import { MapPanel } from '../../charts/MapPanel.tsx';
import { TrackMap } from '../../charts/TrackMap.tsx';
import { rememberExercise } from '../../app/current-exercise.ts';
import { formatTime, signedSeconds } from '../../app/format.ts';
import { LoadProblem } from '../../app/NotFound.tsx';
import { errorText, useResource } from '../../app/resource.ts';
import { counted } from '../../app/plural.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { useSession } from '../../app/session.tsx';
import { RecurringDifferences } from '../attempts/RecurringDifferences.tsx';
import { nextTitle, primaryAction, type Action } from '../exercises/next-step.ts';
import { spokenCues } from '../drive/cue-display.ts';
import { ExerciseHeader } from './ExerciseHeader.tsx';
import { useExercise } from './use-exercise.ts';
import './overview.css';

type ReferenceData = { trace: ReferenceTrace; cues: ReferenceCue[]; corners: CornerInfo[] };

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

function ReferenceMap({ title, reference }: { title: string; reference: ReferenceData }) {
  const [open, setOpen] = useState(false);
  const { trace, cues, corners } = reference;
  return (
    <MapPanel title={`Reference line, ${Math.round(trace.lengthM)} m`} legend={['reference', 'turn', 'cue', 'muted']} onView={() => setOpen(true)}>
      <TrackMap
        label="Reference line with the voice cues and the turns"
        reference={trace}
        marks={[
          ...cornerMarks(corners),
          ...cues.map((cue, index) => ({ sM: cue.sM, label: String(index + 1), muted: cue.muted, title: `Cue ${index + 1}: ${cue.phrase ?? cue.kind}` }))
        ]}
      />
      <MapDialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        lengthM={trace.lengthM}
        reference={trace}
        corners={corners}
        items={cueItems(cues)}
        listTitle="Voice cues"
        listHint="Select a cue to find it on the line."
      />
    </MapPanel>
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
