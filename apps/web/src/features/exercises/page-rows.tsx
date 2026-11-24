import type { CatalogueListEntry, Exercise } from '@gt7/contracts';
import { formatSeconds, formatTime } from '../../app/format.ts';
import { t } from '../../app/i18n.ts';
import { Icon } from '../../app/icons.tsx';
import { Link, paths } from '../../app/router.tsx';
import { CIRCUIT_EXPERIENCE, exerciseTitle, whereText } from '../exercise/use-exercise-where.ts';
import { isMine, OWN } from './exercise-page.ts';
import { statusLabel } from './next-step.ts';

export type RowName = { title: string; sub: string | null };

export function exerciseRowName(exercise: Exercise, entry: CatalogueListEntry | null, wide: boolean): RowName {
  const { title, detail } = exerciseTitle(exercise);
  const sector = exercise.family === CIRCUIT_EXPERIENCE && exercise.code !== null;
  return {
    title: sector ? exercise.code! : title,
    sub: whereText({ family: exercise.family, detail: wide ? detail : (detail ?? entry?.track ?? null) })
  };
}

export function entryRowName(entry: CatalogueListEntry): RowName {
  if (entry.family === CIRCUIT_EXPERIENCE) return { title: entry.code ?? entry.name, sub: null };
  return entry.code ? { title: entry.code, sub: entry.name } : { title: entry.name, sub: null };
}

export function ownRowName(exercise: Exercise): RowName {
  return { title: exercise.name, sub: exercise.family };
}

export function NameCell({ name }: { name: RowName }) {
  return (
    <span className="page-row-name">
      <b>{name.title}</b>
      {name.sub ? <span>{name.sub}</span> : null}
    </span>
  );
}

export function PlaceCell({ entry }: { entry: CatalogueListEntry | null }) {
  if (!entry) return <span className="page-row-place" />;
  return (
    <span className="page-row-place">
      <span>{entry.track ?? t('exercises.home.no-track')}</span>
      {entry.car ? <span>{entry.car}</span> : null}
    </span>
  );
}

export function targetText(targetMs: number): string {
  return t('exercises.home.target-time', { time: formatTime(targetMs) });
}

export function StateCell({ exercise, targetMs, wide }: { exercise: Exercise | null; targetMs: number | null; wide: boolean }) {
  if (exercise && isMine(exercise) && exercise.bestMs !== null) {
    const reached = exercise.status === 'target-reached';
    const gap = exercise.targetGapMs;
    return (
      <span className="page-row-state">
        <b className="page-row-time">{formatTime(exercise.bestMs)}</b>
        {reached ? <span className="tag y">{statusLabel(exercise.status)}</span> : null}
        {!reached && gap !== null ? <span className="page-row-gap">{wide ? t('exercises.home.to-target', { gap: formatSeconds(gap) }) : formatSeconds(gap)}</span> : null}
      </span>
    );
  }
  return <span className="page-row-state page-row-target">{targetMs !== null ? targetText(targetMs) : null}</span>;
}

function OpenCell() {
  return (
    <span className="page-row-end">
      <Icon name="chevron-right" size={20} />
    </span>
  );
}

type ExerciseRowProps = { exercise: Exercise; entry: CatalogueListEntry | null; name: RowName; current: boolean; wide: boolean };

export function ExerciseRow({ exercise, entry, name, current, wide }: ExerciseRowProps) {
  return (
    <Link to={paths.exercise(exercise.id)} className={current ? 'page-row current' : 'page-row'}>
      <NameCell name={name} />
      {wide ? <PlaceCell entry={entry} /> : null}
      <StateCell exercise={exercise} targetMs={exercise.targetMs} wide={wide} />
      {wide ? <OpenCell /> : null}
    </Link>
  );
}

export function familyName(family: string): string {
  return family === OWN ? t('exercises.home.own-family') : family;
}
