import { api } from '../../api/client.ts';
import { abortReasonText, formatGap, formatTime, metres } from '../../app/format.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths } from '../../app/router.tsx';
import { differenceText } from '../cues/cue-format.ts';
import './summary.css';

export function AttemptSummary({ attemptId, onDriveAgain }: { attemptId: string; onDriveAgain?: () => void }) {
  const attempt = useResource(() => api.attempt(attemptId), [attemptId]);

  if (attempt.error) return <p className="error">{errorText(attempt.error)}</p>;
  if (!attempt.data) return <p className="sub">Reading the attempt…</p>;
  const data = attempt.data;

  const complete = data.completion === 'complete';
  return (
    <section className="panel summary" aria-label={`Attempt ${data.number}`}>
      <p className="sub">
        Attempt {data.number}, {data.mode === 'guided' ? 'with voice' : 'without voice'}
      </p>
      <div className="summary-time">{complete && data.timeMs !== null ? formatTime(data.timeMs) : 'No time'}</div>
      {!complete ? (
        <p className="sub">The attempt did not finish{data.reason ? ` (${abortReasonText(data.reason)})` : ''}. Only complete attempts have a time.</p>
      ) : (
        <p className="sub">{data.timeMs === null ? 'No time from the game.' : 'Time from the game.'}</p>
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
