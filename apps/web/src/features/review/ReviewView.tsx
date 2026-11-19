import { useState } from 'react';
import type { AttemptReaction, AttemptReview, AttemptSummary, CornerReview, Difference, Exercise, ReferenceInfo, ReviewSeries, TurnLossInfo } from '@gt7/contracts';
import { api, ApiError } from '../../api/client.ts';
import { ChannelChart, type ChartBand, type ChartTick } from '../../charts/ChannelChart.tsx';
import { signedTickLabel, tickLabel, tickStep, valueTicks } from '../../charts/ticks.ts';
import { TrackMap, type TrackLine } from '../../charts/TrackMap.tsx';
import { DangerRow } from '../../app/DangerRow.tsx';
import { useWideLayout } from '../../app/layout.ts';
import { formatDateTime, formatDay, formatTime, metres, signedSeconds } from '../../app/format.ts';
import { rememberedExerciseId, rememberExercise } from '../../app/current-exercise.ts';
import { LoadProblem } from '../../app/NotFound.tsx';
import { errorText, useResource } from '../../app/resource.ts';
import { useSession } from '../../app/session.tsx';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { cornerMarks } from '../../charts/corner-marks.ts';
import { apexPlaceText, apexSpeedText, differenceText, reactionText } from '../cues/cue-format.ts';
import { DeleteAttemptsDialog } from '../attempts/DeleteAttemptsDialog.tsx';
import { groupByTurn, type TurnGroup, type TurnOrder } from './turn-groups.ts';
import './review.css';

const KPH_PER_MPS = 3.6;
const WIDE_APEX_M = 2;

function line(review: AttemptReview, series: ReviewSeries): TrackLine {
  return { gridM: review.gridM, x: series.x, z: series.z };
}

function at(values: (number | null)[], index: number): number | null {
  return values[index] ?? null;
}

function scaled(values: (number | null)[], factor: number): (number | null)[] {
  return values.map(value => (value === null ? null : value * factor));
}

function finite(values: (number | null)[][]): number[] {
  return values.flat().filter((value): value is number => value !== null);
}

function timeLossS(review: AttemptReview): (number | null)[] {
  return review.attempt.t.map((t, index) => {
    const reference = review.reference.t[index];
    return t === null || reference === null || reference === undefined ? null : (t - reference) / 1000;
  });
}


function turnBands(review: AttemptReview): ChartBand[] {
  return review.corners.map((corner, index) => {
    const nextTurnInSM = review.corners[index + 1]?.turnInSM ?? review.lengthM;
    const toSM = Math.min(corner.apexSM + (corner.apexSM - corner.turnInSM), nextTurnInSM, review.lengthM);
    return { fromSM: corner.turnInSM, toSM, label: `T${corner.number}` };
  });
}

function percent(value: number | null): string {
  return value === null ? 'no data' : `${Math.round(value * 100)}%`;
}

function both(reference: string, you: string): string {
  return `reference ${reference}, you ${you}`;
}

function referenceName(reference: ReferenceInfo): string {
  return `${reference.origin === 'demo' ? 'Demonstration' : 'Your attempt'}, ${formatDay(reference.createdAt)}${reference.active ? ', active' : ''}`;
}

const SHARE_TICKS: ChartTick[] = [
  { value: 0, label: '0%' },
  { value: 0.5, label: '50%' },
  { value: 1, label: '100%' }
];

const VALUE_TICK_COUNT = 3;

function ticksOf(min: number, max: number, label: (value: number, step: number) => string): ChartTick[] {
  const values = valueTicks(min, max, VALUE_TICK_COUNT);
  const step = tickStep(values);
  return values.map(value => ({ value, label: label(value, step) }));
}

type ChartsProps = { review: AttemptReview; cursorSM: number; onCursor(sM: number): void };

function Charts({ review, cursorSM, onCursor }: ChartsProps) {
  const index = Math.min(review.reference.v.length - 1, Math.round(cursorSM / review.gridM));
  const refSpeed = scaled(review.reference.v, KPH_PER_MPS);
  const youSpeed = scaled(review.attempt.v, KPH_PER_MPS);
  const speeds = finite([refSpeed, youSpeed]);
  const loss = timeLossS(review);
  const lossLimit = Math.max(0.1, ...finite([loss]).map(Math.abs)) * 1.1;
  const kph = (value: number | null) => (value === null ? 'no data' : `${Math.round(value)}`);
  const lossAt = at(loss, index);
  const lateral = at(review.attempt.lat, index);
  const bands = turnBands(review);
  const common = { gridM: review.gridM, lengthM: review.lengthM, cursorSM, onCursor, bands };
  const speedMin = Math.min(...speeds) * 0.9;
  const speedMax = Math.max(...speeds) * 1.05;
  return (
    <div className="charts">
      <ChannelChart
        {...common}
        id="speed"
        label="Speed, km/h"
        series={[
          { name: 'ref', values: refSpeed },
          { name: 'you', values: youSpeed }
        ]}
        min={speedMin}
        max={speedMax}
        ticks={ticksOf(speedMin, speedMax, tickLabel)}
        turnLabels
        readout={both(kph(at(refSpeed, index)), kph(at(youSpeed, index)))}
      />
      <ChannelChart
        {...common}
        id="throttle"
        label="Throttle"
        series={[
          { name: 'ref', values: review.reference.th },
          { name: 'you', values: review.attempt.th }
        ]}
        min={0}
        max={1}
        ticks={SHARE_TICKS}
        readout={both(percent(at(review.reference.th, index)), percent(at(review.attempt.th, index)))}
      />
      <ChannelChart
        {...common}
        id="brake"
        label="Brake"
        series={[
          { name: 'ref', values: review.reference.br },
          { name: 'you', values: review.attempt.br }
        ]}
        min={0}
        max={1}
        ticks={SHARE_TICKS}
        readout={both(percent(at(review.reference.br, index)), percent(at(review.attempt.br, index)))}
      />
      <ChannelChart
        {...common}
        id="time"
        label="Time lost to the reference, s"
        series={[{ name: 'ink', values: loss }]}
        min={-lossLimit}
        max={lossLimit}
        ticks={ticksOf(-lossLimit, lossLimit, signedTickLabel)}
        readout={lossAt === null ? 'no match here' : `${lossAt >= 0 ? '+' : ''}${lossAt.toFixed(2)} s${lateral === null ? '' : `, ${Math.abs(lateral).toFixed(1)} m from the line`}`}
      />
      <p className="cursor-line" aria-live="polite">
        Cursor at {Math.round(cursorSM)} m of {Math.round(review.lengthM)} m
      </p>
      <p className="sub">Move the pointer or a finger across a chart, or focus a chart and use the arrow keys. The map point shows the same place.</p>
    </div>
  );
}

type DifferencesProps = { findings: Difference[]; losses: TurnLossInfo[]; selected: number | null; onSelect(index: number): void };

function lostText(lostMs: number | null): string | null {
  if (lostMs === null || lostMs === 0) return null;
  return `${(Math.abs(lostMs) / 1000).toFixed(2)} s ${lostMs > 0 ? 'lost' : 'gained'}`;
}

function TurnGroupList({ group, selected, onSelect }: { group: TurnGroup; selected: number | null; onSelect(index: number): void }) {
  const badge = group.turn === null ? 'Whole section' : `T${group.turn}`;
  const range = group.fromSM === null || group.toSM === null ? null : `${Math.round(group.fromSM)}–${Math.round(group.toSM)} m`;
  const lost = lostText(group.lostMs);
  return (
    <div className="turn-group" role="group" aria-label={[badge, range, lost].filter(Boolean).join(' ')}>
      <div className="turn-head" aria-hidden="true">
        <span className="turn-badge">{badge}</span>
        <span className="turn-range">{range}</span>
        {lost ? <b className={group.lostMs! > 0 ? 'turn-lost' : 'turn-gained'}>{lost}</b> : null}
      </div>
      {group.items.map(({ difference, index }) => (
        <button key={`${difference.kind}-${difference.sM}`} type="button" className="diff" aria-pressed={selected === index} onClick={() => onSelect(index)}>
          <span className="diff-at">
            {metres(difference.sM)}
            <span className="visually-hidden">.</span>
          </span>{' '}
          <span className="diff-text">{differenceText(difference)}</span>
        </button>
      ))}
    </div>
  );
}

const ORDER_TEXT: Record<TurnOrder, string> = {
  track: 'Turns in the order of the section.',
  'time-lost': 'Largest time lost first.'
};

function OrderSwitch({ order, onOrder }: { order: TurnOrder; onOrder(order: TurnOrder): void }) {
  return (
    <fieldset className="plain turn-order">
      <legend className="visually-hidden">Order of the turns</legend>
      <div className="segmented">
        <label>
          <input type="radio" name="turn-order" checked={order === 'track'} onChange={() => onOrder('track')} />
          Track
        </label>
        <label>
          <input type="radio" name="turn-order" checked={order === 'time-lost'} onChange={() => onOrder('time-lost')} />
          Time lost
        </label>
      </div>
    </fieldset>
  );
}

function Differences({ findings, losses, selected, onSelect }: DifferencesProps) {
  const [order, setOrder] = useState<TurnOrder>('track');
  const groups = groupByTurn(findings, losses, order);
  return (
    <section aria-labelledby="differences-title" className="differences">
      <h2 id="differences-title">Differences by turn</h2>
      {groups.length > 1 ? <OrderSwitch order={order} onOrder={setOrder} /> : null}
      <p className="sub">{ORDER_TEXT[order]} Time lost is measured from telemetry. Select a difference to put the cursor there. The reference is one recorded drive, not the best possible line.</p>
      {findings.length === 0 ? <p className="notice">No differences above the limits in this attempt.</p> : null}
      {groups.map(group => (
        <TurnGroupList key={group.turn ?? 'whole'} group={group} selected={selected} onSelect={onSelect} />
      ))}
    </section>
  );
}

function Corners({ corners }: { corners: CornerReview[] }) {
  if (corners.length === 0) return null;
  return (
    <section aria-labelledby="corners-title" className="corners">
      <h2 id="corners-title">Corners</h2>
      <p className="sub">Your line at each apex, measured from the reference line. Inside and outside follow the bend of the reference.</p>
      <ol className="corner-list">
        {corners.map(corner => {
          const outside = corner.outsideM !== null && corner.outsideM > WIDE_APEX_M;
          return (
            <li key={corner.number} className={outside ? 'wide' : undefined}>
              <b>Turn {corner.number}</b>
              <span>
                <span className="place">{apexPlaceText(corner.outsideM)}</span>
                <small>
                  Apex {metres(corner.apexSM)}. {apexSpeedText(corner)}
                </small>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Reactions({ reactions }: { reactions: AttemptReaction[] }) {
  if (reactions.length === 0) return null;
  return (
    <section aria-labelledby="reaction-title" className="reactions">
      <h2 id="reaction-title">Brake reaction</h2>
      <ul>
        {reactions.map(reaction => (
          <li key={reaction.eventKey}>
            {metres(Number(reaction.eventKey.slice(reaction.eventKey.indexOf('@') + 1)))}: you started to brake {reactionText(reaction.reactionMs)}
          </li>
        ))}
      </ul>
      <p className="sub">Measured from the start of the spoken phrase to brake pressure above 10%. Move a cue in the cue list if it comes too late.</p>
    </section>
  );
}

function ReviewMap({ review, cursorSM, selected, onSelect }: { review: AttemptReview; cursorSM: number; selected: number | null; onSelect(index: number): void }) {
  return (
    <div className="review-map">
      <div className="plot">
        <TrackMap
          label="Map of the reference line and your line"
          reference={line(review, review.reference)}
          attempt={line(review, review.attempt)}
          cursorSM={cursorSM}
          marks={[
            ...cornerMarks(review.corners),
            ...review.findings.map((finding, index) => ({
              sM: finding.sM,
              selected: selected === index,
              onAttempt: true,
              title: `${metres(finding.sM)}. ${differenceText(finding)}`,
              onSelect: () => onSelect(index)
            }))
          ]}
        />
      </div>
      <div className="legend">
        <span>
          <i className="ref" />
          reference
        </span>
        <span>
          <i className="you" />
          you
        </span>
        <span>A gap in your line is a place without a match</span>
        <span>Map orientation is not confirmed</span>
      </div>
    </div>
  );
}

const NO_GAME_TIME_TEXT = 'This attempt has no time from the game. Only a complete attempt with a time from the game can become a reference.';

function promoteProblem(error: unknown): string {
  return error instanceof ApiError && error.code === 'no-game-time' ? NO_GAME_TIME_TEXT : errorText(error);
}

function AttemptFacts({ attempt }: { attempt: AttemptSummary }) {
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const promotable = attempt.completion === 'complete' && attempt.gameMs !== null;
  const promote = async () => {
    setProblem(null);
    try {
      await api.promoteAttempt(attempt.id);
      setMessage('This attempt is now the active reference. The demonstration stays in the reference history.');
    } catch (error) {
      setProblem(promoteProblem(error));
    }
  };
  return (
    <div className="facts">
      <div className="kv">
        <span>Source</span>
        <b>
          frames {attempt.first}–{attempt.last}
        </b>
      </div>
      <div className="kv">
        <span>Voice</span>
        <b>{attempt.mode === 'guided' ? 'with voice' : 'without voice'}</b>
      </div>
      {promotable ? (
        <button className="btn ghost" type="button" onClick={() => void promote()}>
          Use this attempt as a reference
        </button>
      ) : (
        <p className="sub">Only a complete attempt with a time from the game can become a reference.</p>
      )}
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
      {message ? (
        <p className="sub" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function ReviewBody({ attempt, review, references }: { attempt: AttemptSummary; review: AttemptReview; references: ReferenceInfo[] }) {
  const wide = useWideLayout();
  const { navigate } = useRouter();
  const [cursorSM, setCursorSM] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const select = (index: number) => {
    setSelected(index);
    setCursorSM(review.findings[index]!.sM);
  };
  const switchReference = (referenceId: string) => navigate(paths.review(attempt.id, referenceId === attempt.referenceId ? undefined : referenceId));
  const map = <ReviewMap review={review} cursorSM={cursorSM} selected={selected} onSelect={select} />;
  const charts = <Charts review={review} cursorSM={cursorSM} onCursor={setCursorSM} />;
  const differences = (
    <>
      <Differences findings={review.findings} losses={review.turnLosses} selected={selected} onSelect={select} />
      <Corners corners={review.corners} />
      <Reactions reactions={review.reactions} />
    </>
  );
  const chooser = (
    <div className="field">
      <label htmlFor="compare-with">Compare with</label>
      <select id="compare-with" value={review.referenceId} onChange={event => switchReference(event.target.value)}>
        {references.map(reference => (
          <option key={reference.id} value={reference.id}>
            {referenceName(reference)}
            {reference.id === attempt.referenceId ? ' (driven against)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
  const facts = <AttemptFacts attempt={attempt} />;
  if (!wide) {
    return (
      <div className="review-phone">
        {map}
        {differences}
        {chooser}
        {charts}
        {facts}
      </div>
    );
  }
  return (
    <div className="wide">
      <div>
        {map}
        {charts}
      </div>
      <div>
        {differences}
        {chooser}
        {facts}
      </div>
    </div>
  );
}

function ReviewHeader({ attempt, exercise, review }: { attempt: AttemptSummary; exercise: Exercise | null; review: AttemptReview | null }) {
  const { user } = useSession();
  const gapMs = attempt.completion === 'complete' && attempt.gameMs !== null && review ? attempt.gameMs - review.referenceTimeMs : null;
  const time = attempt.completion === 'complete' ? formatTime(attempt.timeMs) : 'no time';
  const timed = attempt.completion === 'complete' && attempt.timeMs !== null;
  return (
    <header className="review-header">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={paths.exercises()}>Exercises</Link> /{' '}
        {exercise ? (
          <>
            <Link to={paths.exercise(exercise.id)}>{exercise.name}</Link> /{' '}
          </>
        ) : null}
        <Link to={paths.attempts(attempt.exerciseId)}>Attempts</Link> / Attempt {attempt.number}
      </nav>
      <div className="review-title">
        <div>
          <h1>
            Attempt {attempt.number} · {time}
            {gapMs === null ? null : (
              <>
                {' '}
                <span className={gapMs > 0 ? 'review-gap slower' : 'review-gap'}>{signedSeconds(gapMs)} s</span>
              </>
            )}
          </h1>
          <p className="lede">
            {attempt.mode === 'guided' ? 'With voice' : 'Without voice'}, {formatDateTime(attempt.startedAt)}.{' '}
            {attempt.completion !== 'complete' ? 'The attempt did not finish.' : timed ? 'Times from the game.' : 'No time from the game.'}
            {gapMs === null ? '' : ' Gap to the compared reference.'}
          </p>
        </div>
        <Link to={paths.drive(attempt.mode)} className="btn inline" onNavigate={() => rememberExercise(user.id, attempt.exerciseId)}>
          Drive again
        </Link>
      </div>
    </header>
  );
}

function DeleteThisAttempt({ attempt }: { attempt: AttemptSummary }) {
  const { navigate } = useRouter();
  const [confirming, setConfirming] = useState(false);
  const list = useResource(() => (confirming ? api.attempts(attempt.exerciseId) : Promise.resolve(null)), [attempt.exerciseId, confirming]);
  return (
    <>
      <DangerRow title="Delete this attempt" hint="Removes the attempt with its cue events and differences." action="Delete this attempt…" onAction={() => setConfirming(true)} />
      {confirming ? (
        <DeleteAttemptsDialog
          selected={[attempt]}
          all={list.data ? list.data.days.flatMap(day => day.attempts) : null}
          onKeep={() => setConfirming(false)}
          onDeleted={() => navigate(paths.attempts(attempt.exerciseId))}
        />
      ) : null}
    </>
  );
}

export function ReviewView({ attemptId }: { attemptId: string }) {
  const { search } = useRouter();
  const referenceId = search.get('reference') ?? undefined;
  const attempt = useResource(() => api.attempt(attemptId), [attemptId]);
  const review = useResource(() => api.review(attemptId, referenceId), [attemptId, referenceId]);
  const exerciseId = attempt.data?.exerciseId;
  const references = useResource(() => (exerciseId ? api.references(exerciseId) : Promise.resolve([])), [exerciseId]);
  const exercise = useResource(() => (exerciseId ? api.exercise(exerciseId) : Promise.resolve(null)), [exerciseId]);
  const { user } = useSession();
  const error = attempt.error ?? review.error;
  const remembered = rememberedExerciseId(user.id);
  if (error) return <LoadProblem error={error} kind="attempt" {...(remembered ? { exerciseId: remembered } : {})} />;
  if (!attempt.data) return <p className="sub">Reading the attempt…</p>;
  const data = attempt.data;
  return (
    <section>
      <ReviewHeader attempt={data} exercise={exercise.data ?? null} review={review.data ?? null} />
      {review.data ? <ReviewBody key={review.data.referenceId} attempt={data} review={review.data} references={references.data ?? []} /> : <p className="sub">Comparing with the reference…</p>}
      <DeleteThisAttempt attempt={data} />
    </section>
  );
}
