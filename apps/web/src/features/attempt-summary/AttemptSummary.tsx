import { useState, type FormEvent } from 'react';
import { api } from '../../api/client.ts';
import { formatAttemptTime, formatGap, formatOfficialTime, formatTime, metres } from '../../app/format.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths } from '../../app/router.tsx';
import { differenceText } from '../cues/cue-format.ts';
import './summary.css';

export function parseGameTime(text: string): number | null {
  const match = /^\s*(?:(\d+):)?(\d{1,2})(?:[.,](\d{1,3}))?\s*$/.exec(text);
  if (!match) return null;
  const minutes = Number(match[1] ?? 0);
  const seconds = Number(match[2]);
  const fraction = Number((match[3] ?? '0').padEnd(3, '0'));
  if (match[1] !== undefined && seconds >= 60) return null;
  const ms = minutes * 60000 + seconds * 1000 + fraction;
  return ms > 0 ? ms : null;
}

export function AttemptSummary({ attemptId, onDriveAgain }: { attemptId: string; onDriveAgain?: () => void }) {
  const attempt = useResource(() => api.attempt(attemptId), [attemptId]);
  const [official, setOfficial] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  if (attempt.error) return <p className="error">{errorText(attempt.error)}</p>;
  if (!attempt.data) return <p className="sub">Reading the attempt…</p>;
  const data = attempt.data;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const ms = parseGameTime(official);
    if (ms === null) {
      setProblem('Enter the time as the game shows it, for example 0:27.054.');
      return;
    }
    setProblem(null);
    try {
      await api.updateAttempt(data.id, { officialMs: ms });
      setOfficial('');
      attempt.reload();
    } catch (error) {
      setProblem(errorText(error));
    }
  };

  const complete = data.completion === 'complete';
  return (
    <section className="panel summary" aria-label={`Attempt ${data.number}`}>
      <p className="sub">
        Attempt {data.number}, {data.mode === 'guided' ? 'with voice' : 'without voice'}
      </p>
      <div className="summary-time">{complete ? formatAttemptTime(data) : 'No time'}</div>
      {!complete ? (
        <p className="sub">The attempt did not finish{data.reason ? ` (${data.reason})` : ''}. Only complete attempts have a time.</p>
      ) : data.officialMs !== null ? (
        <>
          <p className="official-line">Official time: {formatOfficialTime(data.officialMs)}</p>
          <p className="sub">Measured from telemetry: {formatTime(data.measuredMs)}</p>
        </>
      ) : (
        <p className="sub">Measured from telemetry between the section boundaries. Not the official game time.</p>
      )}
      {data.focus ? (
        <div className="summary-focus">
          <span>Focus for the next attempt</span>
          <b>{data.focus.text}</b>
          <small>A difference from the reference, not proof of a mistake.</small>
        </div>
      ) : null}
      {complete ? (
        <div className="kv">
          <span>Gap to your best</span>
          <b>{data.gapToBestMs === null ? 'first time' : formatGap(data.gapToBestMs)}</b>
        </div>
      ) : null}
      <div className="kv">
        <span>Largest difference</span>
        <b>{data.largestDifference ? `${metres(data.largestDifference.sM)}. ${differenceText(data.largestDifference)}` : 'none found'}</b>
      </div>
      {complete && data.officialMs === null ? (
        <form className="official" onSubmit={save} noValidate>
          <div className="field-row">
            <div className="field">
              <label htmlFor="official-time">Official time from the game</label>
              <input id="official-time" inputMode="decimal" placeholder="0:27.054" value={official} onChange={event => setOfficial(event.target.value)} />
            </div>
            <button className="btn inline ghost" type="submit">
              Save official time
            </button>
          </div>
        </form>
      ) : null}
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="btn-row summary-actions">
        <Link to={paths.review(data.id)} className="btn inline">
          Review this attempt
        </Link>
        {onDriveAgain ? (
          <button className="btn inline ghost" type="button" onClick={onDriveAgain}>
            Drive again
          </button>
        ) : null}
      </div>
    </section>
  );
}
