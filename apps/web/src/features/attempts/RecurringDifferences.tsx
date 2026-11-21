import { useState } from 'react';
import type { Exercise } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { recurringPlaceText } from '../cues/cue-format.ts';
import { TurnTag } from './TurnTag.tsx';
import { t } from '../../app/i18n.ts';

const RECURRING_MINIMUM = 3;
const RECURRING_SHOWN = 3;

export function RecurringDifferences({ exercise }: { exercise: Exercise }) {
  const enough = exercise.completeAttempts >= RECURRING_MINIMUM;
  const recurring = useResource(() => (enough ? api.recurring(exercise.id) : Promise.resolve([])), [exercise.id, enough]);
  const [expanded, setExpanded] = useState(false);
  const items = recurring.data ?? [];
  const shown = expanded ? items : items.slice(0, RECURRING_SHOWN);
  const lead =
    items.length > 0
      ? t('exercises.recurring.lead', { of: items[0]!.of })
      : t('exercises.recurring.lead-empty');
  return (
    <section className="panel recurring-differences attempts-recurring" aria-labelledby="recurring-title">
      <h2 id="recurring-title">{t('exercises.recurring.title')}</h2>
      <p className="sub">{lead}</p>
      {!enough ? (
        <p className="notice">
          {t('exercises.recurring.need', { count: exercise.completeAttempts })}
        </p>
      ) : recurring.error ? (
        <p className="error">{errorText(recurring.error)}</p>
      ) : recurring.data && items.length === 0 ? (
        <p className="sub">{t('exercises.recurring.none')}</p>
      ) : (
        <>
          <ul className="list recurring-list">
            {shown.map(item => (
              <li key={`${item.kind}-${item.eventKey ?? item.sM}`}>
                <TurnTag turn={item.turn} />
                <span className="recurring-place">{recurringPlaceText(item)}</span>
                <span className="sub">{t('exercises.recurring.count', { count: item.count, of: item.of })}</span>
              </li>
            ))}
          </ul>
          {items.length > RECURRING_SHOWN ? (
            <button type="button" className="text-link recurring-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
              {expanded ? t('exercises.recurring.fewer') : t('exercises.recurring.more', { count: items.length - RECURRING_SHOWN })}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
