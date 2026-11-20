import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KPH_PER_MPS, WIDE_APEX_M, eventKeyPlace, type AttemptReaction, type AttemptReview, type AttemptSummary, type CornerReview, type Difference, type ReferenceInfo, type ReviewSeries, type TurnLossInfo } from '@gt7/contracts';
import { api, ApiError } from '../../api/client.ts';
import { ChannelChart, type ChartBand, type ChartSeries, type ChartTick } from '../../charts/ChannelChart.tsx';
import { signedTickLabel, tickLabel, tickStep, valueTicks } from '../../charts/ticks.ts';
import { MapDialog, type MapDialogItem } from '../../charts/MapDialog.tsx';
import { MapPanel } from '../../charts/MapPanel.tsx';
import { TrackMap, type TrackCallout, type TrackLine } from '../../charts/TrackMap.tsx';
import { SIDE_FACTOR, beyondSide, largestSideInZones, sideScaledLine } from '../../charts/geometry.ts';
import { Icon } from '../../app/icons.tsx';
import { useWideLayout } from '../../app/layout.ts';
import { abortReasonText, formatDateTime, formatDay, formatTime, metres, signedSeconds } from '../../app/format.ts';
import { rememberedExerciseId, rememberExercise } from '../../app/current-exercise.ts';
import { LoadProblem } from '../../app/NotFound.tsx';
import { errorText, useResource } from '../../app/resource.ts';
import { useSession } from '../../app/session.tsx';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { cornerMarks } from '../../charts/corner-marks.ts';
import { ON_THE_LINE_M, apexPlaceText, apexSpeedText, differenceText, reactionText } from '../cues/cue-format.ts';
import { DeleteAttemptsDialog } from '../attempts/DeleteAttemptsDialog.tsx';
import { ExerciseHeader } from '../exercise/ExerciseHeader.tsx';
import { groupByTurn, type TurnGroup, type TurnOrder } from './turn-groups.ts';
import './review.css';


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
  return review.corners.map(corner => ({ fromSM: corner.zoneFromSM, toSM: corner.zoneToSM, label: `T${corner.number}` }));
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

const SIDE_LIMIT_MIN_M = 1;
const SIDE_LIMIT_MARGIN = 1.1;
const SIDE_LIMIT_OF_CUE = 1.5;
const SIDE_HEIGHT_PHONE = 140;
const SIDE_HEIGHT_WIDE = 180;

function sideTicks(limit: number): ChartTick[] {
  const inner = valueTicks(-limit, limit, VALUE_TICK_COUNT).filter(value => Math.abs(value) < limit - 1e-9);
  const step = tickStep(inner);
  return [
    { value: limit, label: 'right' },
    ...inner.map(value => (value === 0 ? { value, label: 'line', tone: 'ref' as const } : { value, label: tickLabel(Math.abs(value), step) })),
    { value: -limit, label: 'left' }
  ];
}

function sideText(lateral: number | null): string {
  if (lateral === null) return 'no match here';
  if (Math.abs(lateral) <= ON_THE_LINE_M) return 'on the line';
  return `${Math.abs(lateral).toFixed(1)} m ${lateral > 0 ? 'right' : 'left'} of the line`;
}

function SideLegend({ sideCueDistanceM }: { sideCueDistanceM: number | null }) {
  return (
    <div className="legend side-legend">
      <span>
        <i className="ref" />
        reference line
      </span>
      <span>
        <i className="you" />
        you
      </span>
      {sideCueDistanceM === null ? null : (
        <span>
          <i className="dash" />
          side cue distance, {sideCueDistanceM} m
        </span>
      )}
    </div>
  );
}

type ChartsProps = { review: AttemptReview; sideCueDistanceM: number | null; cursorSM: number; onCursor(sM: number): void; onScrub(sM: number): void };

type Channel = { id: string; label: string; series: ChartSeries[]; min: number; max: number; ticks: ChartTick[]; turnLabels?: boolean; marks?: number[]; height?: number; area?: boolean };

type Derived = { refSpeed: (number | null)[]; youSpeed: (number | null)[]; loss: (number | null)[]; bands: ChartBand[]; channels: Channel[] };

function derive(review: AttemptReview, sideCueDistanceM: number | null, sideHeight: number): Derived {
  const refSpeed = scaled(review.reference.v, KPH_PER_MPS);
  const youSpeed = scaled(review.attempt.v, KPH_PER_MPS);
  const speeds = finite([refSpeed, youSpeed]);
  const loss = timeLossS(review);
  const lossLimit = Math.max(0.1, ...finite([loss]).map(Math.abs)) * 1.1;
  const speedMin = Math.min(...speeds) * 0.9;
  const speedMax = Math.max(...speeds) * 1.05;
  const sideLimit = Math.max(SIDE_LIMIT_MIN_M, (sideCueDistanceM ?? 0) * SIDE_LIMIT_OF_CUE, ...finite([review.attempt.lat]).map(Math.abs).map(value => value * SIDE_LIMIT_MARGIN));
  const pair = (ref: (number | null)[], you: (number | null)[]): ChartSeries[] => [
    { name: 'ref', values: ref },
    { name: 'you', values: you }
  ];
  return {
    refSpeed,
    youSpeed,
    loss,
    bands: turnBands(review),
    channels: [
      { id: 'speed', label: 'Speed, km/h', series: pair(refSpeed, youSpeed), min: speedMin, max: speedMax, ticks: ticksOf(speedMin, speedMax, tickLabel), turnLabels: true },
      { id: 'throttle', label: 'Throttle', series: pair(review.reference.th, review.attempt.th), min: 0, max: 1, ticks: SHARE_TICKS },
      { id: 'brake', label: 'Brake', series: pair(review.reference.br, review.attempt.br), min: 0, max: 1, ticks: SHARE_TICKS },
      {
        id: 'side',
        label: 'Distance from the reference line, m',
        series: [
          { name: 'ref', values: review.attempt.lat.map(value => (value === null ? null : 0)) },
          { name: 'you', values: review.attempt.lat }
        ],
        min: -sideLimit,
        max: sideLimit,
        ticks: sideTicks(sideLimit),
        marks: sideCueDistanceM === null ? [] : [sideCueDistanceM, -sideCueDistanceM],
        height: sideHeight,
        area: true
      },
      { id: 'time', label: 'Time lost to the reference, s', series: [{ name: 'ink', values: loss }], min: -lossLimit, max: lossLimit, ticks: ticksOf(-lossLimit, lossLimit, signedTickLabel) }
    ]
  };
}

function Charts({ review, sideCueDistanceM, cursorSM, onCursor, onScrub }: ChartsProps) {
  const wide = useWideLayout();
  const index = Math.min(review.reference.v.length - 1, Math.round(cursorSM / review.gridM));
  const { refSpeed, youSpeed, loss, bands, channels } = useMemo(() => derive(review, sideCueDistanceM, wide ? SIDE_HEIGHT_WIDE : SIDE_HEIGHT_PHONE), [review, sideCueDistanceM, wide]);
  const kph = (value: number | null) => (value === null ? 'no data' : `${Math.round(value)}`);
  const lossAt = at(loss, index);
  const lateral = at(review.attempt.lat, index);
  const readouts: Record<string, string> = {
    speed: both(kph(at(refSpeed, index)), kph(at(youSpeed, index))),
    throttle: both(percent(at(review.reference.th, index)), percent(at(review.attempt.th, index))),
    brake: both(percent(at(review.reference.br, index)), percent(at(review.attempt.br, index))),
    time: lossAt === null ? 'no match here' : `${lossAt >= 0 ? '+' : ''}${lossAt.toFixed(2)} s`,
    side: sideText(lateral)
  };
  return (
    <div className="charts">
      {channels.map(channel => (
        <ChannelChart
          key={channel.id}
          legend={channel.id === 'side' ? <SideLegend sideCueDistanceM={sideCueDistanceM} /> : null}
          gridM={review.gridM}
          lengthM={review.lengthM}
          cursorSM={cursorSM}
          onCursor={onCursor}
          onScrub={onScrub}
          bands={bands}
          {...channel}
          readout={readouts[channel.id]!}
        />
      ))}
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
  const lost = lostText(group.lostMs);
  return (
    <div className="turn-group" role="group" aria-label={[badge, lost].filter(Boolean).join(' · ')}>
      <div className="turn-head" aria-hidden="true">
        <span className="turn-badge">{badge}</span>
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

const Differences = memo(function Differences({ findings, losses, selected, onSelect }: DifferencesProps) {
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
});

const Corners = memo(function Corners({ corners }: { corners: CornerReview[] }) {
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
});

const Reactions = memo(function Reactions({ reactions }: { reactions: AttemptReaction[] }) {
  if (reactions.length === 0) return null;
  return (
    <section aria-labelledby="reaction-title" className="reactions">
      <h2 id="reaction-title">Brake reaction</h2>
      <ul>
        {reactions.map(reaction => (
          <li key={reaction.eventKey}>
            {metres(eventKeyPlace(reaction.eventKey) ?? 0)}: you started to brake {reactionText(reaction.reactionMs)}
          </li>
        ))}
      </ul>
      <p className="sub">Measured from the start of the spoken phrase to brake pressure above 10%. Move a cue in the cue list if it comes too late.</p>
    </section>
  );
});

type MapScale = 'true' | 'side';

const MAP_LABEL = 'Map of the reference line and your line';

function sideCallouts(review: AttemptReview): TrackCallout[] {
  return largestSideInZones(review.corners, review.attempt.lat, review.gridM).map(peak => ({
    turn: peak.turn,
    sM: peak.sM,
    side: peak.lat < 0 ? -1 : 1,
    title: `T${peak.turn} · ${Math.abs(peak.lat).toFixed(1)} m ${peak.lat < 0 ? 'left' : 'right'}`,
    detail: `at ${metres(peak.sM)}`
  }));
}

function MapSwitch({ scale, onScale }: { scale: MapScale; onScale(scale: MapScale): void }) {
  return (
    <div className="map-switch" role="group" aria-label="Side distance on the map">
      <button type="button" aria-pressed={scale === 'true'} onClick={() => onScale('true')}>
        True scale
      </button>
      <button type="button" aria-pressed={scale === 'side'} onClick={() => onScale('side')}>
        Side distance × {SIDE_FACTOR}
      </button>
    </div>
  );
}

type ReviewMapProps = { title: string; review: AttemptReview; sideCueDistanceM: number | null; cursorSM: number; selected: number | null; onSelect(index: number): void };

function differenceItems(findings: Difference[]): MapDialogItem[] {
  return findings.map(finding => ({
    key: `${finding.kind}-${finding.sM}`,
    number: finding.turn === null ? '' : `T${finding.turn}`,
    label: differenceText(finding),
    detail: metres(finding.sM),
    sM: finding.sM,
    onAttempt: true
  }));
}

function ReviewMap({ title, review, sideCueDistanceM, cursorSM, selected, onSelect }: ReviewMapProps) {
  const [scale, setScale] = useState<MapScale>('true');
  const [viewing, setViewing] = useState(false);
  const side = scale === 'side';
  const reference = useMemo(() => line(review, review.reference), [review]);
  const trueAttempt = useMemo(() => line(review, review.attempt), [review]);
  const sideAttempt = useMemo(() => (side ? sideScaledLine(reference, review.attempt.lat, SIDE_FACTOR) : null), [side, reference, review]);
  const far = useMemo(() => (sideAttempt && sideCueDistanceM !== null ? beyondSide(sideAttempt, review.attempt.lat, sideCueDistanceM) : null), [sideAttempt, sideCueDistanceM, review]);
  const callouts = useMemo(() => (side ? sideCallouts(review) : []), [side, review]);
  const corners = useMemo(() => cornerMarks(review.corners), [review.corners]);
  const marks = useMemo(
    () => [
      ...corners,
      ...review.findings.map((finding, index) => ({
        sM: finding.sM,
        selected: selected === index,
        onAttempt: true,
        title: `${metres(finding.sM)}. ${differenceText(finding)}`,
        onSelect: () => onSelect(index)
      }))
    ],
    [corners, review.findings, selected, onSelect]
  );
  const label = side
    ? `${MAP_LABEL}. The side distance of your line is drawn ${SIDE_FACTOR} times larger.${callouts.length > 0 ? ` ${callouts.map(callout => callout.title.replace(' · ', ' ')).join(', ')}.` : ''}`
    : MAP_LABEL;
  return (
    <MapPanel
      title="Your line"
      legend={['reference', 'you', 'turn']}
      far={side && sideCueDistanceM !== null ? `more than ${sideCueDistanceM} m from the line` : null}
      notes={['A gap in your line is a place without a match']}
      actions={<MapSwitch scale={scale} onScale={setScale} />}
      onView={() => setViewing(true)}
      below={
        side ? (
          <p className="map-note">
            Your line is drawn {SIDE_FACTOR} times farther from the reference line than it was, so that a difference of 1 m shows. The labels give the true distance at the largest point of each turn.
          </p>
        ) : null
      }
    >
      <div className="review-map">
        <TrackMap label={label} reference={reference} attempt={sideAttempt ?? trueAttempt} far={far} callouts={callouts} cursorSM={cursorSM} marks={marks} />
      </div>
      <MapDialog
        open={viewing}
        onClose={() => setViewing(false)}
        title={title}
        lengthM={review.lengthM}
        reference={reference}
        attempt={trueAttempt}
        corners={review.corners}
        items={differenceItems(review.findings)}
        listTitle="Differences"
        listHint="Select a difference to find it on your line."
      />
    </MapPanel>
  );
}

function AttemptFacts({ attempt }: { attempt: AttemptSummary }) {
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const promotable = attempt.completion === 'complete';
  const promote = async () => {
    setProblem(null);
    try {
      await api.promoteAttempt(attempt.id);
      setMessage('This attempt is now the active reference. The demonstration stays in the reference history.');
    } catch (error) {
      setProblem(errorText(error));
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
      {promotable ? (
        <button className="btn ghost" type="button" onClick={() => void promote()}>
          Use this attempt as a reference
        </button>
      ) : (
        <p className="sub">Only a complete attempt can become a reference.</p>
      )}
      <DeleteThisAttempt attempt={attempt} />
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

function useFrameCursor(): [number, (sM: number) => void, (sM: number) => void] {
  const [cursorSM, setCursorSM] = useState(0);
  const frame = useRef<number | null>(null);
  const pending = useRef(0);
  const cancel = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);
  const setNow = useCallback(
    (sM: number) => {
      cancel();
      setCursorSM(sM);
    },
    [cancel]
  );
  const scrub = useCallback((sM: number) => {
    pending.current = sM;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setCursorSM(pending.current);
    });
  }, []);
  useEffect(() => cancel, [cancel]);
  return [cursorSM, setNow, scrub];
}

function ReviewBody({ title, attempt, review, references, sideCueDistanceM }: { title: string; attempt: AttemptSummary; review: AttemptReview; references: ReferenceInfo[]; sideCueDistanceM: number | null }) {
  const wide = useWideLayout();
  const { navigate } = useRouter();
  const [cursorSM, setCursorNow, scrub] = useFrameCursor();
  const [selected, setSelected] = useState<number | null>(null);
  const select = useCallback(
    (index: number) => {
      setSelected(index);
      setCursorNow(review.findings[index]!.sM);
    },
    [review.findings, setCursorNow]
  );
  const switchReference = (referenceId: string) => navigate(paths.review(attempt.id, referenceId === attempt.referenceId ? undefined : referenceId));
  const map = <ReviewMap title={title} review={review} sideCueDistanceM={sideCueDistanceM} cursorSM={cursorSM} selected={selected} onSelect={select} />;
  const charts = <Charts review={review} sideCueDistanceM={sideCueDistanceM} cursorSM={cursorSM} onCursor={setCursorNow} onScrub={scrub} />;
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
            {reference.id === attempt.referenceId ? ' (used for this attempt)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
  const facts = <AttemptFacts attempt={attempt} />;
  if (!wide) {
    return (
      <div className="review-phone">
        <DriveAgain attempt={attempt} />
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
        <DriveAgain attempt={attempt} />
        {differences}
        {chooser}
        {facts}
      </div>
    </div>
  );
}

function AttemptHeading({ attempt, review }: { attempt: AttemptSummary; review: AttemptReview | null }) {
  const complete = attempt.completion === 'complete';
  const gapMs = complete && review ? attempt.timeMs - review.referenceTimeMs : null;
  const time = complete ? formatTime(attempt.timeMs) : 'No time';
  return (
    <div className="review-title">
      <Link to={paths.attempts(attempt.exerciseId)} className="icon-button">
        <Icon name="chevron-left" size={16} />
        All attempts
      </Link>
      <div className="review-title-text">
        <h2>
          Attempt {attempt.number} · {time}
          {gapMs === null ? null : (
            <>
              {' '}
              <span className={gapMs > 0 ? 'review-gap slower' : 'review-gap'}>{signedSeconds(gapMs)} s</span>
            </>
          )}
        </h2>
        <p className="lede">
          {formatDateTime(attempt.startedAt)}.{' '}
          {complete ? 'Times from the game.' : `The attempt did not finish${attempt.reason ? ` (${abortReasonText(attempt.reason)})` : ''}.`}
          {gapMs === null ? '' : ' Gap to the compared reference.'}
        </p>
      </div>
    </div>
  );
}

function DriveAgain({ attempt }: { attempt: AttemptSummary }) {
  const { user } = useSession();
  return (
    <Link to={paths.drive()} className="btn review-drive" onNavigate={() => rememberExercise(user.id, attempt.exerciseId)}>
      Drive again
    </Link>
  );
}

function DeleteThisAttempt({ attempt }: { attempt: AttemptSummary }) {
  const { navigate } = useRouter();
  const [confirming, setConfirming] = useState(false);
  const list = useResource(() => (confirming ? api.attempts(attempt.exerciseId) : Promise.resolve(null)), [attempt.exerciseId, confirming]);
  return (
    <>
      <button className="btn danger" type="button" onClick={() => setConfirming(true)}>
        Delete attempt
      </button>
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
      {exercise.data ? <ExerciseHeader exercise={exercise.data} current="attempts" /> : null}
      <AttemptHeading attempt={data} review={review.data ?? null} />
      {review.data && !exercise.loading ? <ReviewBody key={review.data.referenceId} title={exercise.data?.name ?? `Attempt ${data.number}`} attempt={data} review={review.data} references={references.data ?? []} sideCueDistanceM={exercise.data?.sideCueDistanceM ?? null} /> : <p className="sub">Comparing with the reference…</p>}
    </section>
  );
}
