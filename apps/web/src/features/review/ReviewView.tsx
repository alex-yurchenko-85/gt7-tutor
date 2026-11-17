import { useState } from 'react';
import type { AttemptReaction, AttemptReview, AttemptSummary, CornerReview, Difference, ReferenceInfo, ReviewSeries } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { ChannelChart } from '../../charts/ChannelChart.tsx';
import { TrackMap, type TrackLine } from '../../charts/TrackMap.tsx';
import { useWideLayout } from '../../app/layout.ts';
import { formatAttemptTime, formatDay, metres } from '../../app/format.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { cornerMarks } from '../../charts/corner-marks.ts';
import { apexPlaceText, apexSpeedText, differenceText, reactionText } from '../cues/cue-format.ts';
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

function percent(value: number | null): string {
  return value === null ? 'no data' : `${Math.round(value * 100)}%`;
}

function both(reference: string, you: string): string {
  return `reference ${reference}, you ${you}`;
}

function referenceName(reference: ReferenceInfo): string {
  return `${reference.origin === 'demo' ? 'Demonstration' : 'Your attempt'}, ${formatDay(reference.createdAt)}${reference.active ? ', active' : ''}`;
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
  const common = { gridM: review.gridM, lengthM: review.lengthM, cursorSM, onCursor };
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
        min={Math.min(...speeds) * 0.9}
        max={Math.max(...speeds) * 1.05}
        height={130}
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
        height={56}
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
        height={56}
        readout={both(percent(at(review.reference.br, index)), percent(at(review.attempt.br, index)))}
      />
      <ChannelChart
        {...common}
        id="time"
        label="Time lost to the reference, s"
        series={[{ name: 'ink', values: loss }]}
        min={-lossLimit}
        max={lossLimit}
        height={70}
        readout={lossAt === null ? 'no match here' : `${lossAt >= 0 ? '+' : ''}${lossAt.toFixed(2)} s${lateral === null ? '' : `, ${Math.abs(lateral).toFixed(1)} m from the line`}`}
      />
      <p className="cursor-line" aria-live="polite">
        Cursor at {Math.round(cursorSM)} m of {Math.round(review.lengthM)} m
      </p>
      <p className="sub">Move the pointer or a finger across a chart, or focus a chart and use the arrow keys. The map point shows the same place.</p>
    </div>
  );
}

type DifferencesProps = { findings: Difference[]; selected: number | null; onSelect(index: number): void };

function Differences({ findings, selected, onSelect }: DifferencesProps) {
  return (
    <section aria-labelledby="differences-title" className="differences">
      <h2 id="differences-title">Differences from the reference</h2>
      <p className="sub">A difference is not always a mistake: the reference is one recorded drive, not the best possible line.</p>
      {findings.length === 0 ? <p className="notice">No differences above the limits in this attempt.</p> : null}
      {findings.map((finding, index) => (
        <button key={`${finding.kind}-${finding.sM}`} type="button" className="diff" aria-pressed={selected === index} onClick={() => onSelect(index)}>
          <b>
            {metres(finding.sM)}. {differenceText(finding)}
          </b>
          <small>in this attempt</small>
        </button>
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

function AttemptFacts({ attempt }: { attempt: AttemptSummary }) {
  const [message, setMessage] = useState<string | null>(null);
  const promote = async () => {
    try {
      await api.promoteAttempt(attempt.id);
      setMessage('This attempt is now the active reference. The demonstration stays in the reference history.');
    } catch (error) {
      setMessage(errorText(error));
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
      {attempt.completion === 'complete' ? (
        <button className="btn ghost" type="button" onClick={() => void promote()}>
          Use this attempt as a reference
        </button>
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
      <Differences findings={review.findings} selected={selected} onSelect={select} />
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

export function ReviewView({ attemptId }: { attemptId: string }) {
  const { search } = useRouter();
  const referenceId = search.get('reference') ?? undefined;
  const attempt = useResource(() => api.attempt(attemptId), [attemptId]);
  const review = useResource(() => api.review(attemptId, referenceId), [attemptId, referenceId]);
  const exerciseId = attempt.data?.exerciseId;
  const references = useResource(() => (exerciseId ? api.references(exerciseId) : Promise.resolve([])), [exerciseId]);
  const error = attempt.error ?? review.error;
  if (error) return <p className="error">{errorText(error)}</p>;
  if (!attempt.data) return <p className="sub">Reading the attempt…</p>;
  const data = attempt.data;
  const title = `Attempt ${data.number}, ${data.completion === 'complete' ? formatAttemptTime(data) : 'no time'}`;
  return (
    <section>
      <p className="sub">
        <Link to={paths.attempts(data.exerciseId)}>All attempts</Link>
      </p>
      <h1>{title}</h1>
      <p className="lede">
        {data.mode === 'guided' ? 'With voice' : 'Without voice'}, {formatDay(data.startedAt)}.{' '}
        {data.completion === 'complete'
          ? data.officialMs !== null
            ? 'Official time from the game.'
            : 'Time measured from telemetry.'
          : 'The attempt did not finish.'}
      </p>
      {review.data ? <ReviewBody key={review.data.referenceId} attempt={data} review={review.data} references={references.data ?? []} /> : <p className="sub">Comparing with the reference…</p>}
    </section>
  );
}
