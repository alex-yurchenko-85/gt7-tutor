import type { AttemptSummary, Exercise } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { formatAttemptTime, formatDay, formatGap, formatTime, metres } from '../../app/format.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths } from '../../app/router.tsx';
import { differenceText, recurringAtText } from '../cues/cue-format.ts';
import { ExerciseHeader } from '../exercise/ExerciseHeader.tsx';
import { useExercise } from '../exercise/use-exercise.ts';
import './attempts.css';

const RECURRING_MINIMUM = 3;

function AttemptRow({ attempt, bestMs }: { attempt: AttemptSummary; bestMs: number | null }) {
  const complete = attempt.completion === 'complete' && attempt.timeMs !== null;
  const isBest = complete && attempt.timeMs === bestMs;
  return (
    <tr aria-label={`Attempt ${attempt.number}`} className={isBest ? 'best' : undefined}>
      <td>
        <b className="attempt-number">{attempt.number}</b>
      </td>
      <td>
        {complete ? (
          <>
            <b className="attempt-time">{formatAttemptTime(attempt)}</b>
            {isBest ? <span className="tag y best-tag">best</span> : null}
            <br />
            <span className="sub">{attempt.officialMs !== null ? 'official' : 'measured'}</span>
          </>
        ) : (
          <>
            <b className="attempt-time">No time</b>
            <br />
            <span className="sub">aborted{attempt.reason ? `, ${attempt.reason}` : ''}</span>
          </>
        )}
      </td>
      <td>{complete && !isBest ? formatGap(attempt.gapToBestMs) : ''}</td>
      <td className="hide-narrow">{attempt.mode === 'guided' ? 'with voice' : 'without voice'}</td>
      <td className="hide-narrow">
        {attempt.largestDifference ? `${metres(attempt.largestDifference.sM)}. ${differenceText(attempt.largestDifference)}` : ''}
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
        <ul className="list">
          {(recurring.data ?? []).map(item => (
            <li key={`${item.kind}-${item.eventKey ?? item.sM}`}>{recurringAtText(item)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AttemptsView({ exerciseId }: { exerciseId: string }) {
  const exercise = useExercise(exerciseId);
  const attempts = useResource(() => api.attempts(exerciseId), [exerciseId]);
  if (exercise.error) return <p className="error">{errorText(exercise.error)}</p>;
  if (!exercise.data) return <p className="sub">Reading the exercise…</p>;
  const list = attempts.data;
  return (
    <section>
      <ExerciseHeader exercise={exercise.data} />
      <div className="wide">
        <div>
          {list && list.days.length === 0 ? (
            <div className="panel">
              <p className="lede">No attempts yet. Arm an attempt in Drive, then drive the exercise in the game.</p>
              <Link to={paths.drive()} className="btn inline">
                Open Drive
              </Link>
            </div>
          ) : null}
          {list?.days.map(day => (
            <div key={day.date} className="attempt-day">
              <h2>
                {formatDay(day.date)} <span className="sub">{day.bestMs === null ? 'no complete attempt' : `best ${formatTime(day.bestMs)}`}</span>
              </h2>
              <div className="table-wrap">
                <table aria-label={`Attempts on ${formatDay(day.date)}`}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Time</th>
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
                      <AttemptRow key={attempt.id} attempt={attempt} bestMs={list.bestMs} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {attempts.error ? <p className="error">{errorText(attempts.error)}</p> : null}
        </div>
        <Recurring exercise={exercise.data} />
      </div>
    </section>
  );
}
