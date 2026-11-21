import { useState } from 'react';
import type { AttemptDay, AttemptSummary, Exercise } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { abortReasonText, formatDay, formatGap, formatTime, metres } from '../../app/format.ts';
import { LoadProblem } from '../../app/NotFound.tsx';
import { errorText, useResource } from '../../app/resource.ts';
import { Icon } from '../../app/icons.tsx';
import { useWideLayout } from '../../app/layout.ts';
import { Link, paths } from '../../app/router.tsx';
import { SelectionBar } from '../../app/SelectionBar.tsx';
import { differenceText } from '../cues/cue-format.ts';
import { ExerciseHeader } from '../exercise/ExerciseHeader.tsx';
import { useExercise } from '../exercise/use-exercise.ts';
import { DriveButton } from '../drive/DriveButton.tsx';
import { DeleteAttemptsDialog } from './DeleteAttemptsDialog.tsx';
import { RecurringDifferences } from './RecurringDifferences.tsx';
import { TurnTag } from './TurnTag.tsx';
import './attempts.css';
import { t } from '../../app/i18n.ts';

type Selection = { picked: ReadonlySet<string>; toggle(id: string): void };

function rowClass(isBest: boolean, complete: boolean, picked: boolean, selecting: boolean): string | undefined {
  const names = [isBest ? (selecting ? '' : 'best') : complete ? '' : 'aborted', picked ? 'picked' : ''].filter(Boolean);
  return names.length > 0 ? names.join(' ') : undefined;
}

function AttemptRow({ attempt, bestMs, selection, wide }: { attempt: AttemptSummary; bestMs: number | null; selection: Selection | null; wide: boolean }) {
  const complete = attempt.completion === 'complete' && attempt.timeMs !== null;
  const isBest = complete && attempt.timeMs === bestMs;
  const picked = selection?.picked.has(attempt.id) ?? false;
  const gap = complete && !isBest ? formatGap(attempt.gapToBestMs) : '';
  const largest = attempt.largestDifference;
  const largestLine = largest ? (
    <>
      <TurnTag turn={largest.turn} muted={!complete} />
      {t('exercises.attempts.largest', { place: metres(largest.sM), difference: differenceText(largest) })}
    </>
  ) : null;
  const classes = [rowClass(isBest, complete, picked, selection !== null), selection ? 'selectable' : 'linked'].filter(Boolean).join(' ');
  return (
    <tr aria-label={t('exercises.attempts.row', { number: attempt.number })} className={classes} onClick={selection ? () => selection.toggle(attempt.id) : undefined}>
      {selection ? (
        <td className="pick-cell">
          <input
            type="checkbox"
            className="pick-box"
            aria-label={t('exercises.attempts.select-one', { number: attempt.number })}
            checked={picked}
            onClick={event => event.stopPropagation()}
            onChange={() => selection.toggle(attempt.id)}
          />
        </td>
      ) : null}
      <td>
        <b className="attempt-number">{attempt.number}</b>
      </td>
      <td>
        {complete ? (
          <>
            <b className="attempt-time">{formatTime(attempt.timeMs)}</b>
            {isBest ? <span className="tag y best-tag">{t('exercises.attempts.best')}</span> : null}
          </>
        ) : (
          <>
            <b className="attempt-time">{t('exercises.attempts.no-time')}</b>
            <br />
            <span className="sub">{attempt.reason ? t('exercises.attempts.aborted-reason', { reason: abortReasonText(attempt.reason) }) : t('exercises.attempts.aborted')}</span>
          </>
        )}
        {wide ? null : gap ? <span className="phone-gap">{gap}</span> : null}
        {wide || !largestLine ? null : <span className="phone-difference">{largestLine}</span>}
        {selection ? null : (
          <Link to={paths.review(attempt.id)} className="row-link">
            <span className="visually-hidden">{t('exercises.attempts.review', { number: attempt.number })}</span>
          </Link>
        )}
      </td>
      {wide ? <td>{gap}</td> : null}
      {wide ? <td>{largestLine}</td> : null}
      <td className="chevron-cell">{selection ? null : <Icon name="chevron-right" size={18} />}</td>
    </tr>
  );
}

function QuickSelect({ day, onPick }: { day: AttemptDay; onPick(ids: string[]): void }) {
  const aborted = day.attempts.filter(attempt => attempt.completion !== 'complete');
  const choices: { label: string; attempts: AttemptSummary[] }[] = [
    { label: t('exercises.attempts.quick-aborted', { count: aborted.length }), attempts: aborted },
    { label: t('exercises.attempts.quick-day', { count: day.attempts.length }), attempts: day.attempts },
    { label: t('exercises.attempts.quick-none'), attempts: [] }
  ];
  return (
    <div className="quick-select" role="group" aria-label={t('exercises.attempts.quick-label', { day: formatDay(day.date) })}>
      <span className="sub" aria-hidden="true">
        {t('exercises.attempts.select-label')}
      </span>
      {choices.map(choice => (
        <button key={choice.label} type="button" className="chip-button" onClick={() => onPick(choice.attempts.map(attempt => attempt.id))}>
          {choice.label}
        </button>
      ))}
    </div>
  );
}

export function AttemptsView({ exerciseId }: { exerciseId: string }) {
  const exercise = useExercise(exerciseId);
  const attempts = useResource(() => api.attempts(exerciseId), [exerciseId]);
  const [showAborted, setShowAborted] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const wide = useWideLayout();
  if (exercise.error) return <LoadProblem error={exercise.error} kind="exercise" />;
  if (!exercise.data) return <p className="sub">{t('exercises.reading-exercise')}</p>;
  const list = attempts.data;
  const all = (list?.days ?? []).flatMap(day => day.attempts);
  const days = (list?.days ?? [])
    .map(day => ({ ...day, attempts: showAborted ? day.attempts : day.attempts.filter(attempt => attempt.completion === 'complete') }))
    .filter(day => day.attempts.length > 0);
  const selection: Selection | null = selecting
    ? {
        picked,
        toggle: id => {
          const next = new Set(picked);
          if (!next.delete(id)) next.add(id);
          setPicked(next);
        }
      }
    : null;
  const pickOnDay = (day: AttemptDay, ids: string[]) => {
    const next = new Set([...picked].filter(id => !day.attempts.some(attempt => attempt.id === id)));
    for (const id of ids) next.add(id);
    setPicked(next);
  };
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };
  const deleted = () => {
    setConfirming(false);
    stopSelecting();
    attempts.reload();
    exercise.reload();
  };
  const current = exercise.data;
  const hasAttempts = list !== undefined && list !== null && list.days.length > 0;
  const tools = hasAttempts ? (
    <div className="attempts-tools">
      {selecting ? null : (
        <button type="button" className="btn ghost inline" onClick={() => setSelecting(true)}>
          <Icon name="select" size={16} />
          {t('exercises.attempts.select')}
        </button>
      )}
      <button type="button" className={showAborted ? 'btn ghost inline hide-aborted' : 'btn ghost inline hide-aborted hiding'} onClick={() => setShowAborted(!showAborted)}>
        {showAborted ? t('exercises.attempts.hide-aborted') : t('exercises.attempts.show-aborted')}
      </button>
    </div>
  ) : null;
  return (
    <section className={selecting ? 'selecting-page' : undefined}>
      <ExerciseHeader exercise={current} />
      <div className="wide attempts-layout">
        <div className="attempts-drive">
          {current.activeReferenceId ? (
            <DriveButton exerciseId={current.id} referenceId={current.activeReferenceId} />
          ) : (
            <p className="attempts-record">
              {t('exercises.attempts.record-first')}{' '}
              <Link to={paths.record(current.id)} className="text-link">
                {t('exercises.attempts.record')}
              </Link>
            </p>
          )}
        </div>
        {wide ? null : tools}
        <div className="attempts-main">
          {list && list.days.length === 0 ? (
            <div className="attempts-empty">
              <p>{t('exercises.attempts.empty')}</p>
            </div>
          ) : null}
          {wide && hasAttempts && days.length === 0 ? <div className="attempt-day-head">{tools}</div> : null}
          {days.map((day, index) => (
            <div key={day.date} className="attempt-day">
              <div className="attempt-day-head">
                <h2>
                  {formatDay(day.date)} <span className="sub">{day.bestMs === null ? t('exercises.attempts.day-none') : t('exercises.attempts.day-best', { time: formatTime(day.bestMs) })}</span>
                </h2>
                {wide && index === 0 ? tools : null}
              </div>
              {selecting ? <QuickSelect day={day} onPick={ids => pickOnDay(day, ids)} /> : null}
              <div className="table-wrap">
                <table aria-label={t('exercises.attempts.table', { day: formatDay(day.date) })}>
                  <thead>
                    <tr>
                      {selecting ? (
                        <th>
                          <span className="visually-hidden">{t('exercises.attempts.selected')}</span>
                        </th>
                      ) : null}
                      <th>{t('exercises.attempts.number')}</th>
                      <th>{t('exercises.attempts.time')}</th>
                      {wide ? <th>{t('exercises.attempts.gap')}</th> : null}
                      {wide ? <th>{t('exercises.attempts.difference')}</th> : null}
                      <th aria-hidden="true" />
                    </tr>
                  </thead>
                  <tbody>
                    {day.attempts.map(attempt => (
                      <AttemptRow key={attempt.id} attempt={attempt} bestMs={list?.bestMs ?? null} selection={selection} wide={wide} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {attempts.error ? <p className="error">{errorText(attempts.error)}</p> : null}
        </div>
        {hasAttempts ? <RecurringDifferences exercise={current} /> : null}
      </div>
      {selecting ? <SelectionBar count={picked.size} action={t('exercises.attempts.delete-selected', { count: picked.size })} onCancel={stopSelecting} onAction={() => setConfirming(true)} /> : null}
      {confirming ? (
        <DeleteAttemptsDialog selected={all.filter(attempt => picked.has(attempt.id))} all={all} onKeep={() => setConfirming(false)} onDeleted={deleted} />
      ) : null}
    </section>
  );
}
