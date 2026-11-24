import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogueListEntry, CatalogueSource, Exercise, Settings } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { useLiveState } from '../../api/live.tsx';
import { currentExercise, liveExerciseId } from '../../app/current-exercise.ts';
import { useDemo } from '../../app/demo.tsx';
import { formatSeconds, formatTime } from '../../app/format.ts';
import { listText, t } from '../../app/i18n.ts';
import { Icon } from '../../app/icons.tsx';
import { landing } from '../../app/landing.ts';
import { useWideLayout } from '../../app/layout.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { Rich } from '../../app/rich-text.tsx';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { SelectionBar } from '../../app/SelectionBar.tsx';
import { useSession } from '../../app/session.tsx';
import { DriveAction } from '../drive/DriveButton.tsx';
import { afterTargetSave } from '../exercise/target-save.ts';
import { exerciseTitle, whereText } from '../exercise/use-exercise-where.ts';
import { FocusLine } from '../attempts/FocusLine.tsx';
import { latestFocus } from '../attempts/latest-focus.ts';
import { GetReady } from '../get-ready/GetReady.tsx';
import { CatalogueGroups } from './CatalogueGroups.tsx';
import { DeleteExercisesDialog, historyText } from './DeleteExercisesDialog.tsx';
import { catalogueGroups, isFiltered, isInProgress, isMine, NO_PAGE_FILTERS, OWN, pageExercises, pageTracks, type PageFilters } from './exercise-page.ts';
import { ExerciseFilters } from './ExerciseFilters.tsx';
import { orderedFamilies } from './next-step.ts';
import { useOpenNewExercise } from './OwnExercise.tsx';
import { exerciseRowName, ExerciseRow, NameCell, StateCell } from './page-rows.tsx';
import './exercises.css';

type PageData = { exercises: Exercise[]; settings: Settings };

type EntryOf = (exercise: Exercise) => CatalogueListEntry | null;

function continueKicker(exercise: Exercise, entry: CatalogueListEntry | null, wide: boolean): string {
  const where = wide ? whereText({ family: exercise.family, detail: exerciseTitle(exercise).detail, track: entry?.track }) : null;
  return [t('exercises.home.continue'), where].filter(Boolean).join(' · ');
}

function ContinueCard({ exercise, entry, wide }: { exercise: Exercise; entry: CatalogueListEntry | null; wide: boolean }) {
  const { bestMs, targetGapMs: gapMs, targetMs, activeReferenceId } = exercise;
  const attempts = useResource(
    () => (activeReferenceId && exercise.attemptCount > 0 ? api.attempts(exercise.id).catch(() => null) : Promise.resolve(null)),
    [exercise.id, activeReferenceId, exercise.attemptCount]
  );
  const focus = latestFocus(attempts.data, activeReferenceId);
  return (
    <section className="continue">
      <div className="continue-main">
        <p className="continue-kicker">{continueKicker(exercise, entry, wide)}</p>
        <h2>
          <Link to={paths.exercise(exercise.id)} className="continue-name">
            {exerciseTitle(exercise).title}
          </Link>
        </h2>
        {!wide && bestMs !== null ? (
          <p className="continue-line">
            <Rich k="exercises.home.best" parts={{ time: <b>{formatTime(bestMs)}</b> }} />
            {gapMs !== null ? <span className="continue-gap"> · {t('exercises.home.to-target', { gap: formatSeconds(gapMs) })}</span> : null}
          </p>
        ) : null}
        {focus ? <FocusLine focus={focus} /> : null}
      </div>
      {wide && bestMs !== null ? (
        <div className="continue-times">
          <div>
            <b>{formatTime(bestMs)}</b>
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
        {activeReferenceId ? (
          <DriveAction exerciseId={exercise.id} referenceId={activeReferenceId} className="btn continue-primary" problemClass="error continue-problem">
            <Icon name="drive" size={20} />
            {t('drive.button')}
          </DriveAction>
        ) : (
          <Link to={paths.record(exercise.id)} className="btn continue-primary">
            {t('exercises.home.record')}
          </Link>
        )}
        {activeReferenceId && wide ? (
          <Link to={paths.attempts(exercise.id)} className="btn continue-open">
            {t('exercises.home.attempts')}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function SelectRow({ exercise, entry, wide, picked, onToggle }: { exercise: Exercise; entry: CatalogueListEntry | null; wide: boolean; picked: boolean; onToggle(): void }) {
  const name = exerciseRowName(exercise, entry, wide);
  return (
    <label className={picked ? 'page-row selecting picked' : 'page-row selecting'}>
      <input type="checkbox" className="pick-box" checked={picked} onChange={onToggle} />
      <NameCell name={wide ? name : { title: name.title, sub: historyText(exercise) }} />
      {wide ? <span className="page-row-history">{historyText(exercise)}</span> : null}
      <StateCell exercise={exercise} targetMs={exercise.targetMs} wide={wide} />
    </label>
  );
}

type InProgressProps = {
  selectable: Exercise[];
  shown: Exercise[];
  entryOf: EntryOf;
  currentId: string | null;
  wide: boolean;
  onDeleted(): void;
};

function InProgress({ selectable: all, shown, entryOf, currentId, wide, onDeleted }: InProgressProps) {
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const withoutHistory = all.filter(exercise => exercise.attemptCount === 0 && exercise.referenceCount === 0);
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
  return (
    <section className={selecting ? "in-progress selecting-page" : "in-progress"}>
      <div className="page-section-head">
        <h2>
          {t('exercises.home.in-progress')} <span className="count">{shown.length}</span>
        </h2>
        {selecting ? null : (
          <button type="button" className="btn ghost inline" onClick={() => setSelecting(true)}>
            <Icon name="select" size={16} />
            {t('exercises.home.select')}
          </button>
        )}
      </div>
      {selecting ? (
        <>
          <div className="quick-select">
            <span className="sub">{t('exercises.home.select-label')}</span>
            <button type="button" className="chip-button" onClick={() => setPicked(new Set(withoutHistory.map(exercise => exercise.id)))}>
              {t('exercises.home.without-history', { count: withoutHistory.length })}
            </button>
            <button type="button" className="chip-button" onClick={() => setPicked(new Set(all.map(exercise => exercise.id)))}>
              {t('exercises.home.select-all', { count: all.length })}
            </button>
            <button type="button" className="chip-button" onClick={() => setPicked(new Set())}>
              {t('exercises.home.select-none')}
            </button>
          </div>
          {all.map(exercise => (
            <SelectRow key={exercise.id} exercise={exercise} entry={entryOf(exercise)} wide={wide} picked={picked.has(exercise.id)} onToggle={() => toggle(exercise.id)} />
          ))}
          <SelectionBar count={picked.size} action={t('exercises.home.delete-selected', { count: picked.size })} onCancel={stopSelecting} onAction={() => setConfirming(true)} />
          {confirming ? (
            <DeleteExercisesDialog exercises={all.filter(exercise => picked.has(exercise.id))} currentId={currentId} onKeep={() => setConfirming(false)} onDeleted={deleted} />
          ) : null}
        </>
      ) : shown.length === 0 ? (
        <p className="sub in-progress-empty">{t('exercises.home.in-progress-empty')}</p>
      ) : (
        shown.map(exercise => (
          <ExerciseRow
            key={exercise.id}
            exercise={exercise}
            entry={entryOf(exercise)}
            name={exerciseRowName(exercise, entryOf(exercise), wide)}
            current={exercise.id === currentId}
            wide={wide}
          />
        ))
      )}
    </section>
  );
}

function sourcesText(sources: CatalogueSource[]): string {
  return t('exercises.home.sources', { sources: listText(sources.map(source => t('exercises.home.source', { name: source.name, licence: source.licence })), 'conjunction') });
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

function useRecordEntry() {
  const open = useOpenNewExercise();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const record = async (catalogueId: string) => {
    if (busy) return;
    setProblem(null);
    setBusy(true);
    try {
      const created = await api.createExercise({ catalogueId });
      open(created.id, paths.record(created.id));
    } catch (error) {
      setProblem(errorText(error));
      setBusy(false);
    }
  };
  return { busy, problem, record };
}

export function ExercisesView() {
  const { user } = useSession();
  const { state } = useLiveState(snapshot => snapshot);
  const demo = useDemo() !== null;
  const wide = useWideLayout();
  const data = useResource<PageData>(
    () => afterTargetSave().then(() => Promise.all([api.exercises(), api.settings()])).then(([exercises, settings]) => ({ exercises, settings })),
    []
  );
  const catalogue = useResource(() => api.catalogue().catch((): CatalogueListEntry[] => []), []);
  const info = useResource(() => api.catalogueInfo().catch(() => null), []);
  const [filters, setFilters] = useState<PageFilters>(NO_PAGE_FILTERS);
  const [readyDone, setReadyDone] = useState(false);
  const recording = useRecordEntry();
  const liveId = liveExerciseId(state);
  const target = data.data ? landing({ ps5Ip: data.data.settings.ps5Ip, liveMode: state?.mode ?? null, demo }) : null;
  useDriveRedirect(target, liveId);
  const entries = useMemo(() => catalogue.data ?? [], [catalogue.data]);
  const entryOf = useMemo(() => {
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    return (exercise: Exercise) => (exercise.catalogueId ? (byId.get(exercise.catalogueId) ?? null) : null);
  }, [entries]);
  const exercises = useMemo(() => data.data?.exercises ?? [], [data.data]);
  const shownFilters = useDeferredValue(filters);
  const groups = useMemo(() => catalogueGroups(entries, exercises, shownFilters), [entries, exercises, shownFilters]);
  const selectable = useMemo(() => pageExercises(exercises, shownFilters, entries), [exercises, shownFilters, entries]);
  const progress = useMemo(() => selectable.filter(isInProgress), [selectable]);
  const families = useMemo(() => orderedFamilies(entries.map(entry => entry.family)), [entries]);
  const tracks = useMemo(() => pageTracks(entries.filter(entry => filters.family === NO_PAGE_FILTERS.family || entry.family === filters.family)), [entries, filters.family]);

  if (data.error) return <p className="error">{errorText(data.error)}</p>;
  if (!data.data) return <p className="sub">{t('exercises.home.reading')}</p>;
  if (target === 'get-ready' && !readyDone) return <GetReady exerciseCount={exercises.length} onOpenExercises={() => setReadyDone(true)} />;

  const current = currentExercise(exercises, user.id, liveId);
  const newPlayer = !exercises.some(isMine);
  const filtered = isFiltered(shownFilters);
  const nothing = filtered && progress.length === 0 && groups.length === 0;
  const showProgress = exercises.length > 0 && !nothing && (!filtered || progress.length > 0);
  const catalogueCount = groups.filter(group => group.family !== OWN).reduce((total, group) => total + group.total, 0);
  const change = (next: Partial<PageFilters>) => setFilters(old => ({ ...old, ...next }));

  return (
    <div className="exercises-page">
      {wide || !current || newPlayer ? <h1>{t('exercises.home.title')}</h1> : null}
      {newPlayer ? <p className="lede page-lede">{t('exercises.home.lede')}</p> : null}
      {current ? <ContinueCard exercise={current} entry={entryOf(current)} wide={wide} /> : null}
      <ExerciseFilters filters={filters} families={families} tracks={tracks} wide={wide} onChange={change} />
      {showProgress ? (
        <InProgress
          selectable={selectable}
          shown={progress}
          entryOf={entryOf}
          currentId={current?.id ?? null}
          wide={wide}
          onDeleted={data.reload}
        />
      ) : null}
      {nothing ? (
        <div className="panel empty">
          <p>{t('exercises.home.no-match')}</p>
          <p className="sub">{t('exercises.home.no-match-hint')}</p>
          <button className="btn inline ghost" type="button" onClick={() => setFilters(NO_PAGE_FILTERS)}>
            {t('exercises.home.clear')}
          </button>
        </div>
      ) : catalogue.data ? (
        <section className="catalogue">
          <div className="page-section-head">
            <h2>
              {t('exercises.home.catalogue')} <span className="count">{catalogueCount}</span>
            </h2>
          </div>
          {recording.problem ? (
            <p className="error" role="alert">
              {recording.problem}
            </p>
          ) : null}
          <CatalogueGroups groups={groups} filters={shownFilters} currentId={current?.id ?? null} wide={wide} busy={recording.busy} onRecord={id => void recording.record(id)} />
        </section>
      ) : null}
      <p className="sub catalogue-sources">
        {info.data ? `${sourcesText(info.data.sources)} ` : ''}
        {t('exercises.home.no-support')}
      </p>
    </div>
  );
}
