import { useId, type ReactNode } from 'react';
import { formatTime } from '../../app/format.ts';

type TimesPanelProps = { bestMs: number | null; referenceMs: number | null; children?: ReactNode };

export function TimesPanel({ bestMs, referenceMs, children = null }: TimesPanelProps) {
  const titleId = useId();
  if (bestMs === null && referenceMs === null && children === null) return null;
  return (
    <section className="panel overview-times" aria-labelledby={titleId}>
      <h2 id={titleId}>Times from the game</h2>
      <div className="times-row">
        {bestMs !== null ? (
          <div>
            <b>{formatTime(bestMs)}</b>
            <span>your best</span>
          </div>
        ) : null}
        {referenceMs !== null ? (
          <div className="reference-time">
            <b>{formatTime(referenceMs)}</b>
            <span>reference</span>
          </div>
        ) : null}
        {children}
      </div>
    </section>
  );
}
