import { useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogueListEntry, Exercise, Settings } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { useLiveState } from '../../api/live.tsx';
import { currentExercise, liveExerciseId } from '../../app/current-exercise.ts';
import { useDemo } from '../../app/demo.tsx';
import { formatSeconds, formatTime } from '../../app/format.ts';
import { Icon } from '../../app/icons.tsx';
import { landing } from '../../app/landing.ts';
import { useWideLayout } from '../../app/layout.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { SelectionBar } from '../../app/SelectionBar.tsx';
import { useSession } from '../../app/session.tsx';
import { afterTargetSave } from '../exercise/target-save.ts';
import { exerciseTitle, whereText } from '../exercise/use-exercise-where.ts';
import { DriveAction } from '../drive/DriveButton.tsx';
import { GetReady } from '../get-ready/GetReady.tsx';
import { DeleteExercisesDialog, historyText } from './DeleteExercisesDialog.tsx';
import { orderedExercises, orderedFamilies, statusLabel } from './next-step.ts';
import './exercises.css';
import { t } from '../../app/i18n.ts';
import { Rich } from '../../app/rich-text.tsx';

const ALL = '';

type Details = { entry: CatalogueListEntry | null };

type HomeData = { exercises: Exercise[]; settings: Settings };

function homeWhere(exercise: Exercise, details: Details): string {
  return [exerciseTitle(exercise).detail, details.entry?.track, details.entry?.car].filter(Boolean).join(' · ');
}

function phoneWhere(exercise: Exercise): string {
  return whereText({ family: exercise.family, detail: exerciseTitle(exercise).detail });
}

function continueKicker(exercise: Exercise, details: Details, wide: boolean): string {
  const { title, detail } = exerciseTitle(exercise);
  const parts = wide ? [exercise.family, detail, details.entry?.track] : [title === exercise.name ? detail : null];
  return [t('exercises.home.continue'), ...parts].filter(Boolean).join(' · ');
}

function StatusTag({ status }: { status: Exercise['status'] }) {
  const label = statusLabel(status);
  return label === null ? null : <span className={`tag status-${status}`}>{label}</span>;
}

function ContinueCard({ exercise, details, wide }: { exercise: Exercise; details: Details; wide: boolean }) {
  const gapMs = exercise.targetGapMs;
  const targetMs = exercise.targetMs;
  const kicker = continueKicker(exercise, details, wide);
  return (
    <section className="continue">
      <div className="continue-main">
        <p className="continue-kicker">{kicker}</p>
        <h2>
          <Link to={paths.exercise(exercise.id)} className="continue-name">
            {exerciseTitle(exercise).title}
          </Link>
        </h2>
        {!wide && exercise.bestMs !== null ? (
          <p className="continue-line">
            <Rich k="exercises.home.best" parts={{ time: <b>{formatTime(exercise.bestMs)}</b> }} />
            {gapMs !== null ? <span className="continue-gap"> · {t('exercises.home.to-target', { gap: formatSeconds(gapMs) })}</span> : null}
          </p>
        ) : null}
      </div>
      {wide && exercise.bestMs !== null ? (
        <div className="continue-times">
          <div>
            <b>{formatTime(exercise.bestMs)}</b>
            <span>{t('exercises.home.your-best')}</span>
          </div>
          {gapMs !== null && targetMs !== null ? (
            <div className="continue-gap">
              <b>{formatSeconds(gapMs)}</b>
              <span>{t('exercises.home.to-target-time', { time: formatTime(targetMs) })}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="continue-actions">
        {exercise.activeReferenceId ? (
          <DriveAction exerciseId={exercise.id} referenceId={exercise.activeReferenceId} className="btn continue-primary" problemClass="error continue-problem">
            <Icon name="drive" size={20} />
            {t('drive.button')}
          </DriveAction>
        ) : (
          <Link to={paths.record(exercise.id)} className="btn continue-primary">
            {t('exercises.home.record')}
          </Link>
        )}
        <Link to={paths.attempts(exercise.id)} className={wide ? 'btn continue-open' : 'continue-link'}>
          {t('exercises.home.attempts')}
        </Link>
      </div>
    </section>
  );
}

function ExerciseRow({ exercise, details, wide }: { exercise: Exercise; details: Details; wide: boolean }) {
  return (
    <Link to={paths.exercise(exercise.id)} className="exercise-row">
      <span className="exercise-row-name">
        <b>{exerciseTitle(exercise).title}</b>
        <span>{wide ? homeWhere(exercise, details) : phoneWhere(exercise)}</span>
      </span>
      <span>
        <StatusTag status={exercise.status} />
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
      <input type="checkbox" className="pick-box" checked={picked} onChange={onToggle} />
      <span className="exercise-row-name">
        <b>{exerciseTitle(exercise).title}</b>
        <span>{wide ? homeWhere(exercise, details) : historyText(exercise)}</span>
      </span>
      <span>
        <StatusTag status={exercise.status} />
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

type MyExercisesProps = { exercises: Exercise[]; catalogueIds: string[]; detailsOf(exercise: Exercise): Details; wide: boolean; currentId: string | null; onDeleted(): void };

function MyExercises({ exercises, catalogueIds, detailsOf, wide, currentId, onDeleted }: MyExercisesProps) {
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
    <div className="quick-select">
      <span className="sub">
        {t('exercises.home.select-label')}
      </span>
      <button type="button" className="chip-button" onClick={() => setPicked(new Set(withoutHistory.map(exercise => exercise.id)))}>
        {t('exercises.home.without-history', { count: withoutHistory.length })}
      </button>
      <button type="button" className="chip-button" onClick={() => setPicked(new Set(visible.map(exercise => exercise.id)))}>
        {t('exercises.home.select-all', { count: visible.length })}
      </button>
      <button type="button" className="chip-button" onClick={() => setPicked(new Set())}>
        {t('exercises.home.select-none')}
      </button>
    </div>
  ) : null;
  const actions = (
    <div className="my-exercises-actions">
      {exercises.length > 0 && !selecting ? (
        <button type="button" className="btn ghost inline" onClick={() => setSelecting(true)}>
          <Icon name="select" size={16} />
          {t('exercises.home.select')}
        </button>
      ) : null}
      <Link to={paths.addExercise()} className="btn inline add-exercise">
        {wide ? t('exercises.home.add-wide') : t('exercises.home.add-phone')}
      </Link>
    </div>
  );
  return (
    <section className={selecting ? 'my-exercises selecting-page' : 'my-exercises'}>
      <div className="my-exercises-head">
        <h2>
          {t('exercises.home.mine')} <span className="count">{exercises.length}</span>
        </h2>
        {actions}
      </div>
      {wide && (families.length > 1 || quickSelect) ? (
        <div className="my-exercises-tools">
          {families.length > 1 ? (
            <div className="family-filter">
              {[ALL, ...families].map(name => (
                <button key={name} type="button" aria-pressed={family === name} onClick={() => setFamily(name)}>
                  {name === ALL ? t('exercises.home.all') : name}
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
          const members = orderedExercises(exercises.filter(exercise => exercise.family === name), catalogueIds);
          if (members.length === 0) return null;
          return (
            <div key={name} className="family-group">
              {wide ? <h3>{name}</h3> : null}
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
        {exercises.length === 0 ? <p className="sub">{t('exercises.home.empty')}</p> : null}
        {selecting ? (
          <SelectionBar count={picked.size} action={t('exercises.home.delete-selected', { count: picked.size })} onCancel={stopSelecting} onAction={() => setConfirming(true)} />
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
    () => afterTargetSave().then(() => Promise.all([api.exercises(), api.settings()])).then(([exercises, settings]) => ({ exercises, settings })),
    []
  );
  const catalogue = useResource(() => api.catalogue().catch((): CatalogueListEntry[] => []), []);
  const target = data.data
    ? landing({ ps5Ip: data.data.settings.ps5Ip, liveMode: state?.mode ?? null, exerciseCount: data.data.exercises.length, demo })
    : null;
  useDriveRedirect(target, liveExerciseId(state));
  const detailsOf = useMemo(() => {
    const entries = new Map(catalogue.data?.map(entry => [entry.id, entry]) ?? []);
    return (exercise: Exercise): Details => ({ entry: exercise.catalogueId ? (entries.get(exercise.catalogueId) ?? null) : null });
  }, [catalogue.data]);

  if (data.error) return <p className="error">{errorText(data.error)}</p>;
  if (!data.data) return <p className="sub">{t('exercises.home.reading')}</p>;
  if (target === 'get-ready') return <GetReady ps5Ip={data.data.settings.ps5Ip} exerciseCount={data.data.exercises.length} />;
  const { exercises } = data.data;
  const current = currentExercise(exercises, user.id);
  return (
    <div className="exercises-home">
      {wide ? <h1>{t('exercises.home.title')}</h1> : null}
      {current ? <ContinueCard exercise={current} details={detailsOf(current)} wide={wide} /> : null}
      <MyExercises exercises={exercises} catalogueIds={catalogue.data?.map(entry => entry.id) ?? []} detailsOf={detailsOf} wide={wide} currentId={current?.id ?? null} onDeleted={data.reload} />
    </div>
  );
}
