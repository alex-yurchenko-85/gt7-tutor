import type { ExerciseStatusName, ProgressExercise } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { formatDay, formatTime } from '../../app/format.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { recurringAtText } from '../cues/cue-format.ts';
import './progress.css';

const STATUSES: { name: ExerciseStatusName; label: string }[] = [
  { name: 'new', label: 'New' },
  { name: 'ready', label: 'Ready' },
  { name: 'practising', label: 'Practising' },
  { name: 'bronze', label: 'Bronze' },
  { name: 'silver', label: 'Silver' },
  { name: 'gold', label: 'Gold' }
];

const STATUS_LABEL = Object.fromEntries(STATUSES.map(status => [status.name, status.label])) as Record<ExerciseStatusName, string>;

function BestTrend({ days }: { days: ProgressExercise['bestByDay'] }) {
  if (days.length < 2) return null;
  const width = 240;
  const height = 48;
  const times = days.map(day => day.bestMs);
  const low = Math.min(...times);
  const high = Math.max(...times);
  const span = high - low || 1;
  const points = days
    .map((day, index) => `${((index / (days.length - 1)) * (width - 8) + 4).toFixed(1)},${(4 + ((day.bestMs - low) / span) * (height - 8)).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="trend" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}

function RecurringList({ exerciseId }: { exerciseId: string }) {
  const recurring = useResource(() => api.recurring(exerciseId), [exerciseId]);
  if (!recurring.data) return null;
  return (
    <div className="progress-recurring">
      <h4>Recurring differences</h4>
      {recurring.data.length === 0 ? (
        <p className="sub">None yet. A difference counts when it repeats in at least half of your last complete attempts, with at least three.</p>
      ) : (
        <ul className="list">
          {recurring.data.map(item => (
            <li key={`${item.kind}-${item.eventKey ?? item.sM}`}>{recurringAtText(item)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExerciseProgress({ exercise }: { exercise: ProgressExercise }) {
  return (
    <section className="panel progress-exercise" aria-label={exercise.name}>
      <p className="sub">
        {exercise.family}, {exercise.collection}
      </p>
      <h3>{exercise.name}</h3>
      <p>
        <span className="tag">{STATUS_LABEL[exercise.status]}</span>
      </p>
      {exercise.bestMs === null ? (
        <p className="sub">No complete attempt yet.</p>
      ) : (
        <>
          <p className="progress-best">
            <b>{formatTime(exercise.bestMs)}</b> <span className="sub">best, measured</span>
          </p>
          <BestTrend days={exercise.bestByDay} />
          <ul className="list day-list" aria-label="Best time by practice day">
            {exercise.bestByDay.map(day => (
              <li key={day.date}>
                <span>{formatDay(day.date)}</span>
                <b>{formatTime(day.bestMs)}</b>
              </li>
            ))}
          </ul>
          <RecurringList exerciseId={exercise.id} />
        </>
      )}
    </section>
  );
}

export function ProgressView() {
  const progress = useResource(() => api.progress(), []);
  if (progress.error) return <p className="error">{errorText(progress.error)}</p>;
  if (!progress.data) return <h1>Progress</h1>;
  const { collections, exercises } = progress.data;
  return (
    <section>
      <h1>Progress</h1>
      <p className="lede">
        Status for each collection, and for each exercise your best time by practice day and the differences that repeat. Times are measured from telemetry unless you entered the
        official time. A faster time is not always better driving.
      </p>
      {collections.length === 0 ? (
        <p className="notice">No exercises yet. Add one in the catalogue.</p>
      ) : (
        <div className="table-wrap">
          <table aria-label="Status by collection">
            <thead>
              <tr>
                <th>Activity</th>
                <th>Collection</th>
                {STATUSES.map(status => (
                  <th key={status.name}>{status.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {collections.map(collection => (
                <tr key={`${collection.family}/${collection.collection}`} aria-label={`${collection.family}, ${collection.collection}`}>
                  <td>{collection.family}</td>
                  <td>{collection.collection}</td>
                  {STATUSES.map(status => (
                    <td key={status.name} className={collection.counts[status.name] ? 'count' : 'count zero'}>
                      {collection.counts[status.name]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2>Exercises</h2>
      <div className="grid-sections">
        {exercises.map(exercise => (
          <ExerciseProgress key={exercise.id} exercise={exercise} />
        ))}
      </div>
    </section>
  );
}
