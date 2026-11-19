import { useState } from 'react';
import type { AttemptDay, AttemptList, AttemptSummary, Exercise } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { abortReasonText, formatDay, formatGap, formatTime, metres, signedSeconds } from '../../app/format.ts';
import { LoadProblem } from '../../app/NotFound.tsx';
import { errorText, useResource } from '../../app/resource.ts';
import { Icon } from '../../app/icons.tsx';
import { counted } from '../../app/plural.ts';
import { Link, paths } from '../../app/router.tsx';
import { SelectionBar } from '../../app/SelectionBar.tsx';
import { differenceText, recurringAtText } from '../cues/cue-format.ts';
import { ExerciseHeader } from '../exercise/ExerciseHeader.tsx';
import { useExercise } from '../exercise/use-exercise.ts';
import { DeleteAttemptsDialog } from './DeleteAttemptsDialog.tsx';
import { compareVoice, type VoiceGroup } from './voice-compare.ts';
import './attempts.css';

const RECURRING_MINIMUM = 3;
const RECURRING_SHOWN = 3;
const HINT_BELOW = 3;

function TurnTag({ turn, muted = false }: { turn: number | null; muted?: boolean }) {
  if (turn === null) return null;
  return (
    <>
      <span className={muted ? 'tag n turn-tag' : 'tag y turn-tag'}>T{turn}</span>{' '}
    </>
  );
}

function attemptCount(count: number): string {
  return counted(count, 'attempt');
}

type Selection = { picked: ReadonlySet<string>; toggle(id: string): void };


function changeNote(changeMs: number): string {
  if (changeMs < 0) return 'with voice is faster';
  return changeMs > 0 ? 'with voice is slower' : 'no change';
}

function Median({ label, group }: { label: string; group: VoiceGroup }) {
  return (
    <div className="voice-cell">
      <span className="voice-label">{label}</span>
      <b className="voice-value">{group.medianMs === null ? '–' : formatTime(group.medianMs)}</b>
      <span className="voice-note">{attemptCount(group.count)}</span>
    </div>
  );
}

function VoiceComparison({ list, referenceId }: { list: AttemptList; referenceId: string | null }) {
  const { baseline, guided, changeMs } = compareVoice(
    list.days.flatMap(day => day.attempts),
    referenceId
  );
  const hint = baseline.count < HINT_BELOW || guided.count < HINT_BELOW;
  const tone = changeMs === null || changeMs === 0 ? '' : changeMs < 0 ? 'faster' : 'slower';
  return (
    <section className="panel voice-compare" aria-labelledby="voice-compare-title">
      <h2 id="voice-compare-title">Does the voice help?</h2>
      <p className="sub">
        Complete attempts only, times from the game.{hint ? ' With fewer than 3 attempts in a group, treat the change as a hint only.' : ''}
      </p>
      <div className="voice-grid">
        <Median label="Without voice, median" group={baseline} />
        <Median label="With voice, median" group={guided} />
        <div className="voice-cell">
          <span className="voice-label">Change</span>
          <b className={`voice-value ${tone}`}>{changeMs === null ? '–' : `${signedSeconds(changeMs)} s`}</b>
          <span className="voice-note">{changeMs === null ? 'needs attempts with and without voice' : changeNote(changeMs)}</span>
        </div>
      </div>
    </section>
  );
}

function rowClass(isBest: boolean, complete: boolean, picked: boolean): string | undefined {
  const names = [isBest ? 'best' : complete ? '' : 'aborted', picked ? 'picked' : ''].filter(Boolean);
  return names.length > 0 ? names.join(' ') : undefined;
}

function AttemptRow({ attempt, bestMs, selection }: { attempt: AttemptSummary; bestMs: number | null; selection: Selection | null }) {
  const complete = attempt.completion === 'complete' && attempt.timeMs !== null;
  const isBest = complete && attempt.timeMs === bestMs;
  const picked = selection?.picked.has(attempt.id) ?? false;
  return (
    <tr aria-label={`Attempt ${attempt.number}`} className={rowClass(isBest, complete, picked)}>
      {selection ? (
        <td className="pick-cell">
          <input type="checkbox" className="pick-box" aria-label={`Select attempt ${attempt.number}`} checked={picked} onChange={() => selection.toggle(attempt.id)} />
        </td>
      ) : null}
      <td>
        <b className="attempt-number">{attempt.number}</b>
      </td>
      <td>
        {complete ? (
          <>
            <b className="attempt-time">{formatTime(attempt.timeMs)}</b>
            {isBest ? <span className="tag y best-tag">best</span> : null}
          </>
        ) : (
          <>
            <b className="attempt-time">No time</b>
            <br />
            <span className="sub">aborted{attempt.reason ? `, ${abortReasonText(attempt.reason)}` : ''}</span>
          </>
        )}
      </td>
      <td>{complete && !isBest ? formatGap(attempt.gapToBestMs) : ''}</td>
      <td className="hide-narrow">{attempt.mode === 'guided' ? 'with voice' : 'without voice'}</td>
      <td className="hide-narrow">
        {attempt.largestDifference ? (
          <>
            <TurnTag turn={attempt.largestDifference.turn} muted={!complete} />
            {`${metres(attempt.largestDifference.sM)}. ${differenceText(attempt.largestDifference)}`}
          </>
        ) : (
          ''
        )}
      </td>
      <td>
        <Link to={paths.review(attempt.id)} className="btn inline ghost">
          <span aria-hidden="true">Review</span>
          <span className="visually-hidden">Review attempt {attempt.number}</span>
        </Link>
      </td>
    </tr>
  );
}

function Recurring({ exercise }: { exercise: Exercise }) {
  const enough = exercise.completeAttempts >= RECURRING_MINIMUM;
  const recurring = useResource(() => (enough ? api.recurring(exercise.id) : Promise.resolve([])), [exercise.id, enough]);
  const [expanded, setExpanded] = useState(false);
  const items = recurring.data ?? [];
  const shown = expanded ? items : items.slice(0, RECURRING_SHOWN);
  return (
    <section className="panel" aria-labelledby="recurring-title">
      <h2 id="recurring-title">Recurring differences</h2>
      <p className="sub">A difference repeats when it appears at the same place in at least half of your last complete attempts.</p>
      {!enough ? (
        <p className="notice">
          Recurring differences need at least three complete attempts. You have {exercise.completeAttempts}.
        </p>
      ) : recurring.error ? (
        <p className="error">{errorText(recurring.error)}</p>
      ) : recurring.data && recurring.data.length === 0 ? (
        <p className="sub">No difference repeats in your last attempts.</p>
      ) : (
        <>
          <ul className="list recurring-list">
            {shown.map(item => (
              <li key={`${item.kind}-${item.eventKey ?? item.sM}`}>
                <TurnTag turn={item.turn} />
                <span>{recurringAtText(item)}</span>
              </li>
            ))}
          </ul>
          {items.length > RECURRING_SHOWN ? (
            <button type="button" className="text-link recurring-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Show fewer' : `Show ${items.length - RECURRING_SHOWN} more`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function QuickSelect({ day, onPick }: { day: AttemptDay; onPick(ids: string[]): void }) {
  const aborted = day.attempts.filter(attempt => attempt.completion !== 'complete');
  const baseline = day.attempts.filter(attempt => attempt.mode === 'baseline');
  const choices: { label: string; attempts: AttemptSummary[] }[] = [
    { label: `Aborted (${aborted.length})`, attempts: aborted },
    { label: `Without voice (${baseline.length})`, attempts: baseline },
    { label: `All on this day (${day.attempts.length})`, attempts: day.attempts },
    { label: 'None', attempts: [] }
  ];
  return (
    <div className="quick-select" role="group" aria-label={`Select on ${formatDay(day.date)}`}>
      <span className="sub" aria-hidden="true">
        Select:
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
  if (exercise.error) return <LoadProblem error={exercise.error} kind="exercise" />;
  if (!exercise.data) return <p className="sub">Reading the exercise…</p>;
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
  return (
    <section className={selecting ? 'selecting-page' : undefined}>
      <ExerciseHeader exercise={exercise.data} />
      {list && list.days.length > 0 ? <VoiceComparison list={list} referenceId={exercise.data.activeReferenceId} /> : null}
      <div className="wide">
        <div>
          {list && list.days.length === 0 ? (
            <div className="panel">
              <p className="lede">No attempts yet. Start an attempt in Drive, then drive the exercise in the game.</p>
              <Link to={paths.drive()} className="btn inline">
                Open Drive
              </Link>
            </div>
          ) : null}
          {list && list.days.length > 0 ? (
            <div className="attempts-tools">
              <label className="aborted-toggle">
                <input type="checkbox" checked={showAborted} onChange={event => setShowAborted(event.target.checked)} /> Show aborted attempts
              </label>
              {selecting ? null : (
                <button type="button" className="btn ghost inline" onClick={() => setSelecting(true)}>
                  <Icon name="select" size={16} />
                  Select
                </button>
              )}
            </div>
          ) : null}
          {days.map(day => (
            <div key={day.date} className="attempt-day">
              <h2>
                {formatDay(day.date)} <span className="sub">{day.bestMs === null ? 'no complete attempt' : `best ${formatTime(day.bestMs)}`}</span>
              </h2>
              {selecting ? <QuickSelect day={day} onPick={ids => pickOnDay(day, ids)} /> : null}
              <div className="table-wrap">
                <table aria-label={`Attempts on ${formatDay(day.date)}`}>
                  <thead>
                    <tr>
                      {selecting ? (
                        <th>
                          <span className="visually-hidden">Selected</span>
                        </th>
                      ) : null}
                      <th>#</th>
                      <th>Time from the game</th>
                      <th>Gap to best</th>
                      <th className="hide-narrow">Voice</th>
                      <th className="hide-narrow">Largest difference</th>
                      <th>
                        <span className="visually-hidden">Review</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.attempts.map(attempt => (
                      <AttemptRow key={attempt.id} attempt={attempt} bestMs={list?.bestMs ?? null} selection={selection} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {selecting ? <p className="sub">One attempt can also be deleted from its Review page: Delete this attempt, at the bottom.</p> : null}
          {attempts.error ? <p className="error">{errorText(attempts.error)}</p> : null}
        </div>
        <Recurring exercise={exercise.data} />
      </div>
      {selecting ? <SelectionBar count={picked.size} action={`Delete ${counted(picked.size, 'attempt')}…`} onCancel={stopSelecting} onAction={() => setConfirming(true)} /> : null}
      {confirming ? (
        <DeleteAttemptsDialog selected={all.filter(attempt => picked.has(attempt.id))} all={all} onKeep={() => setConfirming(false)} onDeleted={deleted} />
      ) : null}
    </section>
  );
}
