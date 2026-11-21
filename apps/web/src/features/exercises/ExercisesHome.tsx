import { useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogueListEntry, Exercise, Progress, Settings } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { useLiveState } from '../../api/live.tsx';
import { currentExercise, liveExerciseId } from '../../app/current-exercise.ts';
import { useDemo } from '../../app/demo.tsx';
import { formatSeconds, formatTime } from '../../app/format.ts';
import { Icon } from '../../app/icons.tsx';
import { landing } from '../../app/landing.ts';
import { useWideLayout } from '../../app/layout.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { counted } from '../../app/plural.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { SelectionBar } from '../../app/SelectionBar.tsx';
import { useSession } from '../../app/session.tsx';
import { DriveAction } from '../drive/DriveButton.tsx';
import { whereText } from '../exercise/use-exercise-where.ts';
import { GetReady } from '../get-ready/GetReady.tsx';
import { DeleteExercisesDialog, historyText } from './DeleteExercisesDialog.tsx';
import { nextTitle, orderedFamilies, STATUS_LABEL } from './next-step.ts';
import './exercises.css';

const ALL = 'All';

type Details = { collection: string | null; entry: CatalogueListEntry | null };

type HomeData = { exercises: Exercise[]; progress: Progress; settings: Settings };

function homeWhere(details: Details): string {
  return whereText({ collection: details.collection, code: details.entry?.code, track: details.entry?.track, car: details.entry?.car });
}

function ContinueCard({ exercise, details, wide }: { exercise: Exercise; details: Details; wide: boolean }) {
  const gap = exercise.nextMedal;
  const kicker = wide
    ? ['Continue', [exercise.family, details.collection].filter(Boolean).join(', '), details.entry?.track].filter(Boolean).join(' · ')
    : ['Continue', [details.collection, details.entry?.code].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  return (
    <section className="continue" aria-labelledby="continue-title">
      <div className="continue-main">
        <p className="continue-kicker">{kicker}</p>
        <h2 id="continue-title">
          <Link to={paths.exercise(exercise.id)} className="continue-name">
            {exercise.name}
          </Link>
        </h2>
        {wide ? (
          <p className="continue-next">{nextTitle(exercise.step)}</p>
        ) : (
          <p className="continue-line">
            {nextTitle(exercise.step)}
            {exercise.bestMs !== null ? (
              <>
                {' '}
                · best <b>{formatTime(exercise.bestMs)}</b>
              </>
            ) : null}
            {gap ? (
              <span className="continue-gap">
                {' '}
                · {formatSeconds(gap.gapMs)} to {gap.medal}
              </span>
            ) : null}
          </p>
        )}
      </div>
      {wide && exercise.bestMs !== null ? (
        <div className="continue-times">
          <div>
            <b>{formatTime(exercise.bestMs)}</b>
            <span>your best, from the game</span>
          </div>
          {gap ? (
            <div className="continue-gap">
              <b>{formatSeconds(gap.gapMs)}</b>
              <span>
                to {gap.medal}, {formatTime(gap.targetMs)}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="continue-actions">
        {exercise.activeReferenceId ? (
          <DriveAction exerciseId={exercise.id} referenceId={exercise.activeReferenceId} className="btn continue-primary" problemClass="error continue-problem">
            <Icon name="drive" size={20} />
            Drive
          </DriveAction>
        ) : (
          <Link to={paths.record(exercise.id)} className="btn continue-primary">
            Record the reference
          </Link>
        )}
        <Link to={paths.attempts(exercise.id)} className={wide ? 'btn continue-open' : 'continue-link'}>
          Attempts
        </Link>
      </div>
    </section>
  );
}

function ExerciseRow({ exercise, details, wide }: { exercise: Exercise; details: Details; wide: boolean }) {
  return (
    <Link to={paths.exercise(exercise.id)} className="exercise-row">
      <span className="exercise-row-name">
        <b>{exercise.name}</b>
        <span>{wide ? homeWhere(details) : [exercise.family, details.collection].filter(Boolean).join(' · ')}</span>
      </span>
      <span>
        <span className={`tag status-${exercise.status}`}>{STATUS_LABEL[exercise.status]}</span>
      </span>
      {wide ? (
        <>
          <span className="exercise-row-best">{exercise.bestMs === null ? '—' : formatTime(exercise.bestMs)}</span>
          <Icon name="chevron-right" size={18} />
        </>
      ) : null}
    </Link>
  );
}

function SelectRow({ exercise, details, wide, picked, onToggle }: { exercise: Exercise; details: Details; wide: boolean; picked: boolean; onToggle(): void }) {
  return (
    <label className={picked ? 'exercise-row selecting picked' : 'exercise-row selecting'}>
      <input type="checkbox" className="pick-box" aria-label={`Select ${exercise.name}`} checked={picked} onChange={onToggle} />
      <span className="exercise-row-name">
        <b>{exercise.name}</b>
        <span>{wide ? homeWhere(details) : historyText(exercise)}</span>
      </span>
      <span>
        <span className={`tag status-${exercise.status}`}>{STATUS_LABEL[exercise.status]}</span>
      </span>
      {wide ? (
        <>
          <span className="exercise-row-best">{exercise.bestMs === null ? '—' : formatTime(exercise.bestMs)}</span>
          <span className="exercise-row-next">{historyText(exercise)}</span>
        </>
      ) : null}
    </label>
  );
}

type MyExercisesProps = { exercises: Exercise[]; detailsOf(exercise: Exercise): Details; wide: boolean; currentId: string | null; onDeleted(): void };

function MyExercises({ exercises, detailsOf, wide, currentId, onDeleted }: MyExercisesProps) {
  const [family, setFamily] = useState(ALL);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const families = orderedFamilies(exercises.map(exercise => exercise.family));
  const shown = families.filter(name => family === ALL || name === family);
  const visible = exercises.filter(exercise => shown.includes(exercise.family));
  const withoutHistory = visible.filter(exercise => exercise.attemptCount === 0 && exercise.referenceCount === 0);
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (!next.delete(id)) next.add(id);
    setPicked(next);
  };
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };
  const deleted = () => {
    setConfirming(false);
    stopSelecting();
    onDeleted();
  };
  const quickSelect = selecting ? (
    <div className="quick-select" role="group" aria-label="Quick select">
      <span className="sub" aria-hidden="true">
        Select:
      </span>
      <button type="button" className="chip-button" onClick={() => setPicked(new Set(withoutHistory.map(exercise => exercise.id)))}>
        Without history ({withoutHistory.length})
      </button>
      <button type="button" className="chip-button" onClick={() => setPicked(new Set(visible.map(exercise => exercise.id)))}>
        All ({visible.length})
      </button>
      <button type="button" className="chip-button" onClick={() => setPicked(new Set())}>
        None
      </button>
    </div>
  ) : null;
  const actions = (
    <div className="my-exercises-actions">
      {exercises.length > 0 && !selecting ? (
        <button type="button" className="btn ghost inline" onClick={() => setSelecting(true)}>
          <Icon name="select" size={16} />
          Select
        </button>
      ) : null}
      <Link to={paths.addExercise()} className="btn inline add-exercise" label="Add exercise">
        {wide ? '+ Add exercise' : '+ Add'}
      </Link>
    </div>
  );
  return (
    <section className={selecting ? 'my-exercises selecting-page' : 'my-exercises'} aria-labelledby="mine-title">
      <div className="my-exercises-head">
        <h2 id="mine-title">
          My exercises <span className="count">{exercises.length}</span>
        </h2>
        {actions}
      </div>
      {wide && (families.length > 1 || quickSelect) ? (
        <div className="my-exercises-tools">
          {families.length > 1 ? (
            <div className="family-filter" role="group" aria-label="Filter">
              {[ALL, ...families].map(name => (
                <button key={name} type="button" aria-pressed={family === name} onClick={() => setFamily(name)}>
                  {name}
                </button>
              ))}
            </div>
          ) : null}
          {quickSelect}
        </div>
      ) : null}
      <div className="my-exercises-list">
        {wide ? null : quickSelect}
        {shown.map(name => {
          const members = exercises.filter(exercise => exercise.family === name);
          if (members.length === 0) return null;
          const id = `family-${name.replace(/\W+/g, '-')}`;
          return (
            <div key={name} className="family-group" role="group" aria-labelledby={id}>
              <h3 id={id} className={wide ? undefined : 'visually-hidden'}>
                {name}
              </h3>
              {members.map(exercise =>
                selecting ? (
                  <SelectRow
                    key={exercise.id}
                    exercise={exercise}
                    details={detailsOf(exercise)}
                    wide={wide}
                    picked={picked.has(exercise.id)}
                    onToggle={() => toggle(exercise.id)}
                  />
                ) : (
                  <ExerciseRow key={exercise.id} exercise={exercise} details={detailsOf(exercise)} wide={wide} />
                )
              )}
            </div>
          );
        })}
        {exercises.length === 0 ? <p className="sub">No exercise yet. Add one from the catalogue.</p> : null}
        {selecting ? (
          <SelectionBar count={picked.size} action={`Delete ${counted(picked.size, 'exercise')}`} onCancel={stopSelecting} onAction={() => setConfirming(true)} />
        ) : null}
        {confirming ? (
          <DeleteExercisesDialog
            exercises={exercises.filter(exercise => picked.has(exercise.id))}
            currentId={currentId}
            onKeep={() => setConfirming(false)}
            onDeleted={deleted}
          />
        ) : null}
      </div>
    </section>
  );
}

function useDriveRedirect(target: string | null, exerciseId: string | null) {
  const { navigate } = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (target !== 'drive' || exerciseId === null || done.current) return;
    done.current = true;
    navigate(paths.drive(exerciseId), { replace: true });
  }, [target, exerciseId, navigate]);
}

export function ExercisesHome() {
  const { user } = useSession();
  const { state } = useLiveState(snapshot => snapshot);
  const demo = useDemo() !== null;
  const wide = useWideLayout();
  const data = useResource<HomeData>(
    () => Promise.all([api.exercises(), api.progress(), api.settings()]).then(([exercises, progress, settings]) => ({ exercises, progress, settings })),
    []
  );
  const catalogue = useResource(() => api.catalogue().catch((): CatalogueListEntry[] => []), []);
  const target = data.data
    ? landing({ ps5Ip: data.data.settings.ps5Ip, liveMode: state?.mode ?? null, exerciseCount: data.data.exercises.length, demo })
    : null;
  useDriveRedirect(target, liveExerciseId(state));
  const detailsOf = useMemo(() => {
    const collections = new Map(data.data?.progress.exercises.map(item => [item.id, item.collection]) ?? []);
    const entries = new Map(catalogue.data?.map(entry => [entry.id, entry]) ?? []);
    return (exercise: Exercise): Details => ({
      collection: collections.get(exercise.id) ?? null,
      entry: exercise.catalogueId ? (entries.get(exercise.catalogueId) ?? null) : null
    });
  }, [data.data, catalogue.data]);

  if (data.error) return <p className="error">{errorText(data.error)}</p>;
  if (!data.data) return <p className="sub">Reading your exercises…</p>;
  if (target === 'get-ready') return <GetReady ps5Ip={data.data.settings.ps5Ip} exerciseCount={data.data.exercises.length} />;
  const { exercises } = data.data;
  const current = currentExercise(exercises, user.id);
  return (
    <div className="exercises-home">
      <h1 className={wide ? undefined : 'visually-hidden'}>Exercises</h1>
      {current ? <ContinueCard exercise={current} details={detailsOf(current)} wide={wide} /> : null}
      <MyExercises exercises={exercises} detailsOf={detailsOf} wide={wide} currentId={current?.id ?? null} onDeleted={data.reload} />
    </div>
  );
}
