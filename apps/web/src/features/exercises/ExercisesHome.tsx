import { useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogueListEntry, Exercise, Progress, ProgressCollection, Settings } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { useLive } from '../../api/live.tsx';
import { currentExercise } from '../../app/current-exercise.ts';
import { useDemo } from '../../app/demo.tsx';
import { formatTime } from '../../app/format.ts';
import { Icon } from '../../app/icons.tsx';
import { landing } from '../../app/landing.ts';
import { useWideLayout } from '../../app/layout.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { counted } from '../../app/plural.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { SelectionBar } from '../../app/SelectionBar.tsx';
import { useSession } from '../../app/session.tsx';
import { GetReady } from '../get-ready/GetReady.tsx';
import { historyText, RemoveExercisesDialog } from './RemoveExercisesDialog.tsx';
import { medalGap, nextStepText, orderedFamilies, primaryAction, STATUS_LABEL, STEP_LABELS } from './next-step.ts';
import './exercises.css';

const ALL = 'All';

type Details = { collection: string | null; entry: CatalogueListEntry | null };

type HomeData = { exercises: Exercise[]; progress: Progress; settings: Settings };

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function whereText(details: Details): string {
  const entry = details.entry;
  const collection = [details.collection, entry?.code].filter(Boolean).join(', ');
  return [collection, entry?.track, entry?.car].filter(Boolean).join(' · ');
}

function StepRail({ exercise }: { exercise: Exercise }) {
  return (
    <ol className="step-rail" aria-label="Four steps">
      {STEP_LABELS.map(({ step, label }) => {
        const state = step < exercise.step ? 'done' : step === exercise.step ? 'now' : 'later';
        return (
          <li key={step} className={state} aria-current={state === 'now' ? 'step' : undefined}>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

function ContinueCard({ exercise, details, wide }: { exercise: Exercise; details: Details; wide: boolean }) {
  const primary = primaryAction(exercise);
  const gap = medalGap(exercise);
  const kicker = wide
    ? ['Continue', [exercise.family, details.collection].filter(Boolean).join(', '), details.entry?.track].filter(Boolean).join(' · ')
    : ['Continue', [details.collection, details.entry?.code].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  return (
    <section className="continue" aria-labelledby="continue-title">
      <div className="continue-main">
        <p className="continue-kicker">{kicker}</p>
        <h2 id="continue-title">{exercise.name}</h2>
        {wide ? (
          <StepRail exercise={exercise} />
        ) : (
          <p className="continue-line">
            {capitalised(nextStepText(exercise))}
            {exercise.bestMs !== null ? (
              <>
                {' '}
                · best <b>{formatTime(exercise.bestMs)}</b>
              </>
            ) : null}
            {gap ? (
              <span className="continue-gap">
                {' '}
                · {seconds(gap.gapMs)} to {gap.medal}
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
              <b>{seconds(gap.gapMs)}</b>
              <span>
                to {gap.medal}, {formatTime(gap.targetMs)}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="continue-actions">
        <Link to={primary.to} className="btn continue-primary" primary>
          {primary.label}
        </Link>
        <Link to={paths.exercise(exercise.id)} className={wide ? 'btn continue-open' : 'continue-link'}>
          Open the exercise
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
        <span>{wide ? whereText(details) : [exercise.family, details.collection].filter(Boolean).join(' · ')}</span>
      </span>
      <span>
        <span className={`tag status-${exercise.status}`}>{STATUS_LABEL[exercise.status]}</span>
      </span>
      {wide ? (
        <>
          <span className="exercise-row-best">{exercise.bestMs === null ? '—' : formatTime(exercise.bestMs)}</span>
          <span className="exercise-row-next">Next: {nextStepText(exercise)}</span>
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
        <span>{wide ? whereText(details) : historyText(exercise)}</span>
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

type MyExercisesProps = { exercises: Exercise[]; detailsOf(exercise: Exercise): Details; wide: boolean; currentId: string | null; onRemoved(): void };

function MyExercises({ exercises, detailsOf, wide, currentId, onRemoved }: MyExercisesProps) {
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
  const removed = () => {
    setConfirming(false);
    stopSelecting();
    onRemoved();
  };
  return (
    <section className={selecting ? 'my-exercises selecting-page' : 'my-exercises'} aria-labelledby="mine-title">
      <div className="my-exercises-head">
        <h2 id="mine-title">
          My exercises <span className="count">{exercises.length}</span>
        </h2>
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
      </div>
      {wide ? (
        <div className="family-filter" role="group" aria-label="Filter">
          {[ALL, ...families].map(name => (
            <button key={name} type="button" aria-pressed={family === name} onClick={() => setFamily(name)}>
              {name}
            </button>
          ))}
        </div>
      ) : null}
      {selecting ? (
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
      ) : null}
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
        <SelectionBar count={picked.size} action={`Remove ${counted(picked.size, 'exercise')}…`} onCancel={stopSelecting} onAction={() => setConfirming(true)} />
      ) : null}
      {confirming ? (
        <RemoveExercisesDialog
          exercises={exercises.filter(exercise => picked.has(exercise.id))}
          fromPage={false}
          currentId={currentId}
          onKeep={() => setConfirming(false)}
          onRemoved={removed}
        />
      ) : null}
    </section>
  );
}

function work(group: ProgressCollection): number {
  return group.counts.ready + group.counts.practising;
}

function medals(group: ProgressCollection): number {
  return group.counts.bronze + group.counts.silver + group.counts.gold;
}

function Collections({ collections }: { collections: ProgressCollection[] }) {
  return (
    <aside className="collections panel" aria-labelledby="collections-title">
      <h2 id="collections-title">Collections</h2>
      <p className="sub">Your exercises by status. Medals use the time from the game.</p>
      <table aria-labelledby="collections-title">
        <thead>
          <tr>
            <th scope="col">Collection</th>
            <th scope="col">new</th>
            <th scope="col">work</th>
            <th scope="col">medal</th>
          </tr>
        </thead>
        <tbody>
          {collections.map(group => (
            <tr key={`${group.family}-${group.collection}`}>
              <td>
                {group.family}, {group.collection}
              </td>
              <td>{group.counts.new}</td>
              <td>{work(group)}</td>
              <td>{medals(group)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  );
}

function useDriveRedirect(target: string | null) {
  const { navigate } = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (target !== 'drive' || done.current) return;
    done.current = true;
    navigate(paths.drive(), { replace: true });
  }, [target, navigate]);
}

export function ExercisesHome() {
  const { user } = useSession();
  const { state } = useLive();
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
  useDriveRedirect(target);
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
  const { exercises, progress } = data.data;
  const current = currentExercise(exercises, user.id);
  return (
    <div className="exercises-home">
      <h1 className={wide ? undefined : 'visually-hidden'}>Exercises</h1>
      {current ? <ContinueCard exercise={current} details={detailsOf(current)} wide={wide} /> : null}
      <div className="exercises-columns">
        <MyExercises exercises={exercises} detailsOf={detailsOf} wide={wide} currentId={current?.id ?? null} onRemoved={data.reload} />
        {wide && progress.collections.length > 0 ? <Collections collections={progress.collections} /> : null}
      </div>
    </div>
  );
}
