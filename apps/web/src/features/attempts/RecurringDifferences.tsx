import { useState } from 'react';
import type { Exercise } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { recurringPlaceText } from '../cues/cue-format.ts';
import { TurnTag } from './TurnTag.tsx';

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
      ? `At the same place in at least half of your last ${items[0]!.of} complete attempts.`
      : 'A difference repeats when it appears at the same place in at least half of your last complete attempts.';
  return (
    <section className="panel recurring-differences attempts-recurring" aria-labelledby="recurring-title">
      <h2 id="recurring-title">Recurring differences</h2>
      <p className="sub">{lead}</p>
      {!enough ? (
        <p className="notice">
          Recurring differences need at least three complete attempts. You have {exercise.completeAttempts}.
        </p>
      ) : recurring.error ? (
        <p className="error">{errorText(recurring.error)}</p>
      ) : recurring.data && items.length === 0 ? (
        <p className="sub">No difference repeats in your last attempts.</p>
      ) : (
        <>
          <ul className="list recurring-list">
            {shown.map(item => (
              <li key={`${item.kind}-${item.eventKey ?? item.sM}`}>
                <TurnTag turn={item.turn} />
                <span className="recurring-place">{recurringPlaceText(item)}</span>
                <span className="sub">
                  {item.count} of {item.of}
                </span>
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
