import { Fragment, memo, useMemo, useState, type ReactNode } from 'react';
import { KPH_PER_MPS, type AttemptReview, type Difference, type ReviewSeries, type TurnLossInfo, type MessageKey } from '@gt7/contracts';
import { ChannelChart, type ChartBand, type ChartField, type ChartSeries, type ChartTick } from '../../charts/ChannelChart.tsx';
import { labelledTicks, signedTickLabel, tickLabel, tickStep, valueTicks } from '../../charts/ticks.ts';
import { MapDialog, type MapDialogItem } from '../../charts/MapDialog.tsx';
import { MapPanel } from '../../charts/MapPanel.tsx';
import { TrackMap, type TrackCallout, type TrackLine } from '../../charts/TrackMap.tsx';
import { SIDE_FACTOR, beyondSide, largestSideInZones, sideScaledLine } from '../../charts/geometry.ts';
import { cornerMarks } from '../../charts/corner-marks.ts';
import { useWideLayout } from '../../app/layout.ts';
import { metres } from '../../app/format.ts';
import { ON_THE_LINE_M, differenceText } from '../cues/cue-format.ts';
import { groupByTurn, type TurnGroup, type TurnOrder } from './turn-groups.ts';
import './review.css';
import { listText, t } from '../../app/i18n.ts';

export type LineComparison = Pick<AttemptReview, 'gridM' | 'lengthM' | 'reference' | 'attempt' | 'findings' | 'turnLosses' | 'corners'>;

export type LineWords = {
  referenceName: string;
  youName: string;
  referenceLegend: string;
  youLegend: string;
  timeLabel: string;
  timeNote?: string;
  mapTitle: string;
  mapTitleHidden?: boolean;
  fields?: Record<string, ChartField>;
  mapLabel: string;
  mapNotes: string[];
  sideLabel: string;
  sideNote: string;
  dialogLabel: string;
  dialogHint: string;
  dialogLine: string;
  hint: string;
  cursorText(cursorSM: number, lengthM: number): string;
  metres(value: number): string;
  describe(difference: Difference): string;
};

function line(review: LineComparison, series: ReviewSeries): TrackLine {
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

function timeLossS(review: LineComparison): (number | null)[] {
  return review.attempt.t.map((t, index) => {
    const reference = review.reference.t[index];
    return t === null || reference === null || reference === undefined ? null : (t - reference) / 1000;
  });
}

function turnBands(review: LineComparison): ChartBand[] {
  return review.corners.map(corner => ({ fromSM: corner.zoneFromSM, toSM: corner.zoneToSM, label: t('charts.turn.badge', { turn: corner.number }) }));
}

function percent(value: number | null): string {
  return value === null ? t('exercises.compare.no-data') : t('app.unit.percent', { value: Math.round(value * 100) });
}

function shareTicks(): ChartTick[] {
  return [0, 0.5, 1].map(value => ({ value, label: t('app.unit.percent', { value: value * 100 }) }));
}

const VALUE_TICK_COUNT = 3;

function ticksOf(min: number, max: number, label: (value: number, step: number) => string): ChartTick[] {
  return labelledTicks(min, max, VALUE_TICK_COUNT, label);
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
    { value: limit, label: t('exercises.compare.right') },
    ...inner.map(value => (value === 0 ? { value, label: t('exercises.compare.line'), tone: 'ref' as const } : { value, label: tickLabel(Math.abs(value), step) })),
    { value: -limit, label: t('exercises.compare.left') }
  ];
}

function sideText(lateral: number | null): string {
  if (lateral === null) return t('exercises.compare.no-match');
  if (Math.abs(lateral) <= ON_THE_LINE_M) return t('exercises.compare.on-line');
  return t(lateral > 0 ? 'exercises.compare.side-right' : 'exercises.compare.side-left', { metres: Math.abs(lateral).toFixed(1) });
}

function SideLegend({ words, sideCueDistanceM }: { words: LineWords; sideCueDistanceM: number | null }) {
  return (
    <div className="legend side-legend">
      <span>
        <i className="ref" />
        {words.referenceLegend}
      </span>
      <span>
        <i className="you" />
        {words.youLegend}
      </span>
      {sideCueDistanceM === null ? null : (
        <span>
          <i className="dash" />
          {t('exercises.compare.side-cue', { metres: sideCueDistanceM })}
        </span>
      )}
    </div>
  );
}

type Channel = { id: string; label: string; series: ChartSeries[]; min: number; max: number; ticks: ChartTick[]; turnLabels?: boolean; marks?: number[]; height?: number; area?: boolean };

type Derived = { refSpeed: (number | null)[]; youSpeed: (number | null)[]; loss: (number | null)[]; bands: ChartBand[]; channels: Channel[] };

function derive(review: LineComparison, words: LineWords, side: boolean, sideCueDistanceM: number | null, sideHeight: number): Derived {
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
  const sideChannel: Channel = {
    id: 'side',
    label: t('exercises.compare.side-chart'),
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
  };
  return {
    refSpeed,
    youSpeed,
    loss,
    bands: turnBands(review),
    channels: [
      { id: 'speed', label: t('exercises.compare.speed-chart'), series: pair(refSpeed, youSpeed), min: speedMin, max: speedMax, ticks: ticksOf(speedMin, speedMax, tickLabel), turnLabels: true },
      { id: 'throttle', label: t('exercises.compare.throttle-chart'), series: pair(review.reference.th, review.attempt.th), min: 0, max: 1, ticks: shareTicks() },
      { id: 'brake', label: t('exercises.compare.brake-chart'), series: pair(review.reference.br, review.attempt.br), min: 0, max: 1, ticks: shareTicks() },
      ...(side ? [sideChannel] : []),
      { id: 'time', label: words.timeLabel, series: [{ name: 'ink', values: loss }], min: -lossLimit, max: lossLimit, ticks: ticksOf(-lossLimit, lossLimit, signedTickLabel) }
    ]
  };
}

type CompareChartsProps = { review: LineComparison; words: LineWords; side: boolean; sideCueDistanceM: number | null; cursorSM: number; onCursor(sM: number): void; onScrub(sM: number): void };

export function CompareCharts({ review, words, side, sideCueDistanceM, cursorSM, onCursor, onScrub }: CompareChartsProps) {
  const wide = useWideLayout();
  const index = Math.min(review.reference.v.length - 1, Math.round(cursorSM / review.gridM));
  const { refSpeed, youSpeed, loss, bands, channels } = useMemo(
    () => derive(review, words, side, sideCueDistanceM, wide ? SIDE_HEIGHT_WIDE : SIDE_HEIGHT_PHONE),
    [review, words, side, sideCueDistanceM, wide]
  );
  const kph = (value: number | null) => (value === null ? t('exercises.compare.no-data') : `${Math.round(value)}`);
  const both = (reference: string, you: string) => t('exercises.compare.both', { referenceName: words.referenceName, reference, youName: words.youName, you });
  const lossAt = at(loss, index);
  const lateral = at(review.attempt.lat, index);
  const readouts: Record<string, string> = {
    speed: both(kph(at(refSpeed, index)), kph(at(youSpeed, index))),
    throttle: both(percent(at(review.reference.th, index)), percent(at(review.attempt.th, index))),
    brake: both(percent(at(review.reference.br, index)), percent(at(review.attempt.br, index))),
    time: lossAt === null ? t('exercises.compare.no-match') : t('exercises.compare.loss', { value: `${lossAt >= 0 ? '+' : ''}${lossAt.toFixed(2)}` }),
    side: sideText(lateral)
  };
  const legendFor = (id: string): ReactNode => {
    if (side && id === 'side') return <SideLegend words={words} sideCueDistanceM={sideCueDistanceM} />;
    if (!side && id === 'time') return <SideLegend words={words} sideCueDistanceM={null} />;
    return null;
  };
  return (
    <div className="charts">
      {channels.map(channel => (
        <Fragment key={channel.id}>
          <ChannelChart
            legend={legendFor(channel.id)}
            gridM={review.gridM}
            lengthM={review.lengthM}
            cursorSM={cursorSM}
            onCursor={onCursor}
            onScrub={onScrub}
            bands={bands}
            {...channel}
            readout={readouts[channel.id]!}
            {...(words.fields?.[channel.id] ? { field: words.fields[channel.id] } : {})}
          />
          {channel.id === 'time' && words.timeNote ? <p className="sub time-note">{words.timeNote}</p> : null}
        </Fragment>
      ))}
      <p className="cursor-line" aria-live="polite">
        {words.cursorText(cursorSM, review.lengthM)}
      </p>
      <p className="sub">{words.hint}</p>
    </div>
  );
}

const SMALL_LOSS_MS = 5;

function lostText(lostMs: number | null, neutralSmall: boolean): { text: string; tone: 'lost' | 'gained' | 'neutral' } | null {
  if (lostMs === null) return null;
  if (neutralSmall && Math.abs(lostMs) < SMALL_LOSS_MS) return { text: t('app.unit.seconds', { value: '0.00' }), tone: 'neutral' };
  if (lostMs === 0) return null;
  return { text: t(lostMs > 0 ? 'exercises.compare.lost' : 'exercises.compare.gained', { seconds: (Math.abs(lostMs) / 1000).toFixed(2) }), tone: lostMs > 0 ? 'lost' : 'gained' };
}

type TurnGroupListProps = { group: TurnGroup; selected: number | null; neutralSmall: boolean; emptyText: string | null; wholeLabel: string; describe(difference: Difference): string; onSelect(index: number): void };

function TurnGroupList({ group, selected, neutralSmall, emptyText, wholeLabel, describe, onSelect }: TurnGroupListProps) {
  const badge = group.turn === null ? wholeLabel : t('charts.turn.badge', { turn: group.turn });
  const lost = lostText(group.lostMs, neutralSmall);
  return (
    <div className="turn-group" role="group" aria-label={[badge, lost?.text].filter(Boolean).join(' · ')}>
      <div className="turn-head" aria-hidden="true">
        <span className="turn-badge">{badge}</span>
        {lost ? <b className={lost.tone === 'lost' ? 'turn-lost' : lost.tone === 'gained' ? 'turn-gained' : 'turn-even'}>{lost.text}</b> : null}
      </div>
      {group.items.map(({ difference, index }) => (
        <button key={`${difference.kind}-${difference.sM}`} type="button" className="diff" aria-pressed={selected === index} onClick={() => onSelect(index)}>
          <span className="diff-at">
            {metres(difference.sM)}
            <span className="visually-hidden">.</span>
          </span>{' '}
          <span className="diff-text">{describe(difference)}</span>
        </button>
      ))}
      {group.items.length === 0 && emptyText ? <p className="diff diff-none">{emptyText}</p> : null}
    </div>
  );
}

const ORDER_TEXT: Record<TurnOrder, MessageKey> = {
  track: 'exercises.compare.order-track',
  'time-lost': 'exercises.compare.order-time'
};

function orderText(order: TurnOrder): string {
  return t(ORDER_TEXT[order]);
}

function OrderSwitch({ order, onOrder }: { order: TurnOrder; onOrder(order: TurnOrder): void }) {
  return (
    <fieldset className="plain turn-order">
      <legend className="visually-hidden">{t('exercises.compare.order')}</legend>
      <div className="segmented">
        <label>
          <input type="radio" name="turn-order" checked={order === 'track'} onChange={() => onOrder('track')} />
          {t('exercises.compare.track')}
        </label>
        <label>
          <input type="radio" name="turn-order" checked={order === 'time-lost'} onChange={() => onOrder('time-lost')} />
          {t('exercises.compare.time-lost')}
        </label>
      </div>
    </fieldset>
  );
}

export type DifferencesWords = { intro(order: TurnOrder): string; none: string; emptyTurn: string | null; orderSwitch: boolean; neutralSmall: boolean; allTurns: boolean; wholeLabel: string; describe(difference: Difference): string };

export function reviewDifferences(): DifferencesWords {
  return {
    intro: order => t('exercises.compare.intro', { order: orderText(order) }),
    none: t('exercises.compare.none'),
    emptyTurn: null,
    orderSwitch: true,
    neutralSmall: false,
    allTurns: false,
    wholeLabel: t('exercises.compare.whole'),
    describe: differenceText
  };
}

type DifferencesProps = { findings: Difference[]; losses: TurnLossInfo[]; selected: number | null; words: DifferencesWords; onSelect(index: number): void };

export const Differences = memo(function Differences({ findings, losses, selected, words, onSelect }: DifferencesProps) {
  const [order, setOrder] = useState<TurnOrder>('track');
  const groups = groupByTurn(findings, losses, order, words.allTurns);
  return (
    <section aria-labelledby="differences-title" className="differences">
      <h2 id="differences-title">{t('exercises.compare.title')}</h2>
      {words.orderSwitch && groups.length > 1 ? <OrderSwitch order={order} onOrder={setOrder} /> : null}
      <p className="sub">{words.intro(order)}</p>
      {findings.length === 0 ? <p className="notice">{words.none}</p> : null}
      {groups.map(group => (
        <TurnGroupList key={group.turn ?? 'whole'} group={group} selected={selected} neutralSmall={words.neutralSmall} emptyText={words.emptyTurn} wholeLabel={words.wholeLabel} describe={words.describe} onSelect={onSelect} />
      ))}
    </section>
  );
});

type MapScale = 'true' | 'side';

type SideCallout = TrackCallout & { spoken: string };

function sideCallouts(review: LineComparison): SideCallout[] {
  return largestSideInZones(review.corners, review.attempt.lat, review.gridM).map(peak => {
    const parts = { turn: t('charts.turn.badge', { turn: peak.turn }), metres: Math.abs(peak.lat).toFixed(1), side: peak.lat < 0 ? t('exercises.compare.left') : t('exercises.compare.right') };
    return {
      turn: peak.turn,
      sM: peak.sM,
      side: peak.lat < 0 ? -1 : 1,
      title: t('exercises.compare.callout', parts),
      spoken: t('exercises.compare.callout-spoken', parts),
      detail: t('exercises.compare.callout-at', { place: metres(peak.sM) })
    };
  });
}

function mapLabelOf(words: LineWords, side: boolean, callouts: SideCallout[]): string {
  if (!side) return words.mapLabel;
  if (callouts.length === 0) return t('exercises.compare.map-label-side', { map: words.mapLabel, side: words.sideLabel });
  return t('exercises.compare.map-label-callouts', { map: words.mapLabel, side: words.sideLabel, callouts: listText(callouts.map(callout => callout.spoken), 'unit') });
}

function MapSwitch({ scale, onScale }: { scale: MapScale; onScale(scale: MapScale): void }) {
  return (
    <div className="map-switch" role="group" aria-label={t('exercises.compare.map-switch')}>
      <button type="button" aria-pressed={scale === 'true'} onClick={() => onScale('true')}>
        {t('exercises.compare.true-scale')}
      </button>
      <button type="button" aria-pressed={scale === 'side'} onClick={() => onScale('side')}>
        {t('exercises.compare.side-scale', { factor: SIDE_FACTOR })}
      </button>
    </div>
  );
}

function differenceItems(findings: Difference[], describe: (difference: Difference) => string, place: (value: number) => string): MapDialogItem[] {
  return findings.map(finding => ({
    key: `${finding.kind}-${finding.sM}`,
    number: finding.turn === null ? '' : t('charts.turn.badge', { turn: finding.turn }),
    label: describe(finding),
    detail: place(finding.sM),
    sM: finding.sM,
    onAttempt: true
  }));
}

type CompareMapProps = {
  title: string;
  review: LineComparison;
  words: LineWords;
  sideCueDistanceM: number | null;
  scaleSwitch: boolean;
  cursorSM: number;
  selected: number | null;
  onSelect(index: number): void;
  lapLine?: boolean;
};

export function CompareMap({ title, review, words, sideCueDistanceM, scaleSwitch, cursorSM, selected, onSelect, lapLine = false }: CompareMapProps) {
  const [chosenScale, setScale] = useState<MapScale>('true');
  const [viewing, setViewing] = useState(false);
  const scale = scaleSwitch ? chosenScale : 'true';
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
        title: t('exercises.attempts.largest', { place: metres(finding.sM), difference: words.describe(finding) }),
        onSelect: () => onSelect(index)
      }))
    ],
    [corners, review.findings, selected, onSelect, words]
  );
  const label = mapLabelOf(words, side, callouts);
  return (
    <MapPanel
      title={words.mapTitle}
      hideTitle={words.mapTitleHidden ?? false}
      legend={['reference', 'you', 'turn']}
      legendTexts={{ reference: words.referenceLegend, you: words.youLegend }}
      far={side && sideCueDistanceM !== null ? t('exercises.compare.far', { metres: sideCueDistanceM }) : null}
      notes={words.mapNotes}
      actions={scaleSwitch ? <MapSwitch scale={scale} onScale={setScale} /> : null}
      onView={() => setViewing(true)}
      below={side ? <p className="map-note">{words.sideNote}</p> : null}
    >
      <div className="review-map">
        <TrackMap label={label} reference={reference} attempt={sideAttempt ?? trueAttempt} far={far} callouts={callouts} cursorSM={cursorSM} marks={marks} lapLine={lapLine} />
      </div>
      <MapDialog
        open={viewing}
        onClose={() => setViewing(false)}
        title={title}
        lengthM={review.lengthM}
        reference={reference}
        attempt={trueAttempt}
        corners={review.corners}
        items={differenceItems(review.findings, words.describe, words.metres)}
        listTitle={t('exercises.compare.list-title')}
        listHint={words.dialogHint}
        mapLabel={words.dialogLabel}
        lineName={words.dialogLine}
        lapLine={lapLine}
        metresText={words.metres}
      />
    </MapPanel>
  );
}
