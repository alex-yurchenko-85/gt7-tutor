import { api } from '../../api/client.ts';
import { abortReasonText, formatGap, formatTime } from '../../app/format.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths } from '../../app/router.tsx';
import './summary.css';
import { focusText, t } from '../../app/i18n.ts';

export function AttemptSummary({ attemptId, onDriveAgain }: { attemptId: string; onDriveAgain?: () => void }) {
  const attempt = useResource(() => api.attempt(attemptId), [attemptId]);

  if (attempt.error) return <p className="error">{errorText(attempt.error)}</p>;
  if (!attempt.data) return <p className="sub">{t('exercises.summary.reading')}</p>;
  const data = attempt.data;

  const complete = data.completion === 'complete';
  return (
    <section className="panel summary">
      <p className="sub">{t('exercises.summary.label', { number: data.number })}</p>
      <div className="summary-time">{complete ? formatTime(data.timeMs) : t('exercises.summary.no-time')}</div>
      {!complete ? (
        <p className="sub">{data.reason ? t('exercises.summary.not-finished-reason', { reason: abortReasonText(data.reason) }) : t('exercises.summary.not-finished')}</p>
      ) : (
        <p className="sub">{t('exercises.summary.from-game')}</p>
      )}
      {data.focus ? (
        <div className="summary-focus">
          <span>{t('exercises.summary.focus')}</span>
          <b>{focusText(data.focus)}</b>
        </div>
      ) : null}
      {complete ? (
        <div className="kv">
          <span>{t('exercises.summary.gap')}</span>
          <b>{data.gapToBestMs === null ? t('exercises.summary.first-time') : formatGap(data.gapToBestMs)}</b>
        </div>
      ) : null}
      <div className="summary-actions">
        <Link to={paths.review(data.id)} className="btn inline">
          {t('exercises.summary.review')}
        </Link>
        {onDriveAgain ? (
          <button className="btn inline ghost" type="button" onClick={onDriveAgain}>
            {t('exercises.summary.drive-again')}
          </button>
        ) : null}
      </div>
    </section>
  );
}
