import { Fragment, memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { KPH_PER_MPS, type AttemptReview, type Difference, type ReviewSeries, type TurnLossInfo } from '@gt7/contracts';
import { ChannelChart, type ChartBand, type ChartBoxRow, type ChartField, type ChartRing, type ChartSeries, type ChartTick } from '../../charts/ChannelChart.tsx';
import { labelledTicks, signedTickLabel, tickLabel, tickStep, valueTicks } from '../../charts/ticks.ts';
import { MapDialog, type MapDialogItem } from '../../charts/MapDialog.tsx';
import { MapPanel } from '../../charts/MapPanel.tsx';
import { TrackMap, type TrackLine, type TrackPeak } from '../../charts/TrackMap.tsx';
import { SIDE_FACTOR, beyondSide, largestSideInZones, sideScaledLine } from '../../charts/geometry.ts';
import { cornerMarks } from '../../charts/corner-marks.ts';
import { useWideLayout } from '../../app/layout.ts';
import { SortHeader, useSort, type SortBinding } from '../../app/SortHeader.tsx';
import { metres } from '../../app/format.ts';
import { ON_THE_LINE_M, differenceText } from '../cues/cue-format.ts';
import { groupByTurn, TURN_ORDER_DIRECTIONS, type TurnGroup, type TurnOrder } from './turn-groups.ts';
import './review.css';
import { t } from '../../app/i18n.ts';

export type LineComparison = Pick<AttemptReview, 'gridM' | 'lengthM' | 'reference' | 'attempt' | 'findings' | 'turnLosses' | 'corners'>;

export type BoxLine = 'ref' | 'you';

export type LineWords = {
  referenceLegend: string;
  youLegend: string;
  timeLabel?: string;
  timeNote?: string;
  mapTitle?: string;
  fields?: Record<string, ChartField>;
  mapNotes: string[];
  dialogLine: string;
  boxOrder: BoxLine[];
  boxRow(line: BoxLine, value: string): string;
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

const RING_LABEL_MAX_TURNS = 3;

function lowestSpeedRings(review: LineComparison): ChartRing[] {
  const labelled = review.corners.filter(corner => corner.lowSpeedSM !== null).length <= RING_LABEL_MAX_TURNS;
  const ring = (sM: number, mps: number, tone: ChartRing['tone'], side: ChartRing['side'], place: ChartRing['place']): ChartRing => ({
    sM,
    value: mps * KPH_PER_MPS,
    tone,
    label: labelled ? t('app.unit.kph', { value: Math.round(mps * KPH_PER_MPS) }) : null,
    side,
    place
  });
  return review.corners.flatMap(corner => {
    if (corner.lowSpeedSM === null || corner.lowSpeedMps === null) return [];
    if (corner.attemptLowSM === null || corner.attemptLowMps === null) return [ring(corner.lowSpeedSM, corner.lowSpeedMps, 'ref', 'right', 'below')];
    const referenceFirst = corner.lowSpeedSM <= corner.attemptLowSM;
    const referenceHigher = corner.lowSpeedMps >= corner.attemptLowMps;
    return [
      ring(corner.lowSpeedSM, corner.lowSpeedMps, 'ref', referenceFirst ? 'left' : 'right', referenceHigher ? 'above' : 'below'),
      ring(corner.attemptLowSM, corner.attemptLowMps, 'you', referenceFirst ? 'right' : 'left', referenceHigher ? 'below' : 'above')
    ];
  });
}

function SideLegend({ words, sideCueDistanceM, rings }: { words: LineWords; sideCueDistanceM: number | null; rings: boolean }) {
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
      {rings ? (
        <span className="ring-legend">
          <i className="ring" />
          {t('charts.legend.lowest-speed')}
        </span>
      ) : null}
    </div>
  );
}

type Channel = { id: string; label?: string; series: ChartSeries[]; min: number; max: number; ticks: ChartTick[]; turnLabels?: boolean | 'fit'; marks?: number[]; rings?: ChartRing[]; height?: number; area?: boolean };

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
      { id: 'speed', label: t('exercises.compare.speed-chart'), series: pair(refSpeed, youSpeed), min: speedMin, max: speedMax, ticks: ticksOf(speedMin, speedMax, tickLabel), turnLabels: 'fit', rings: lowestSpeedRings(review) },
      { id: 'throttle', label: t('exercises.compare.throttle-chart'), series: pair(review.reference.th, review.attempt.th), min: 0, max: 1, ticks: shareTicks() },
      { id: 'brake', label: t('exercises.compare.brake-chart'), series: pair(review.reference.br, review.attempt.br), min: 0, max: 1, ticks: shareTicks() },
      ...(side ? [sideChannel] : []),
      { id: 'time', ...(words.timeLabel ? { label: words.timeLabel } : {}), series: [{ name: 'ink', values: loss }], min: -lossLimit, max: lossLimit, ticks: ticksOf(-lossLimit, lossLimit, signedTickLabel) }
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
  const lossAt = at(loss, index);
  const lateral = at(review.attempt.lat, index);
  const timeReadout = lossAt === null ? t('exercises.compare.no-match') : t('exercises.compare.loss', { value: `${lossAt >= 0 ? '+' : ''}${lossAt.toFixed(2)}` });
  const noData = t('exercises.compare.no-data');
  const kphValue = (value: number | null) => (value === null ? noData : t('app.unit.kph', { value: Math.round(value) }));
  const rows = (values: Partial<Record<BoxLine, string>>): ChartBoxRow[] =>
    words.boxOrder.flatMap(line => {
      const value = values[line];
      return value === undefined ? [] : [{ key: line, tone: line, text: words.boxRow(line, value) }];
    });
  const boxes: Partial<Record<string, ChartBoxRow[]>> = {
    speed: rows({ ref: kphValue(at(refSpeed, index)), you: kphValue(at(youSpeed, index)) }),
    throttle: rows({ ref: percent(at(review.reference.th, index)), you: percent(at(review.attempt.th, index)) }),
    brake: rows({ ref: percent(at(review.reference.br, index)), you: percent(at(review.attempt.br, index)) }),
    side: rows({ you: sideText(lateral) })
  };
  const rings = channels.some(channel => (channel.rings ?? []).length > 0);
  const legendFor = (id: string): ReactNode => {
    if (side && id === 'side') return <SideLegend words={words} sideCueDistanceM={sideCueDistanceM} rings={rings} />;
    if (!side && id === 'time') return <SideLegend words={words} sideCueDistanceM={null} rings={rings} />;
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
            {...(boxes[channel.id] ? { box: boxes[channel.id]! } : { readout: timeReadout })}
            {...(words.fields?.[channel.id] ? { field: words.fields[channel.id] } : {})}
          />
          {channel.id === 'time' && words.timeNote ? <p className="sub time-note">{words.timeNote}</p> : null}
        </Fragment>
      ))}
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
    <div className="turn-group">
      <div className="turn-head">
        <span className="turn-badge">{badge}</span>
        {lost ? <b className={lost.tone === 'lost' ? 'turn-lost' : lost.tone === 'gained' ? 'turn-gained' : 'turn-even'}>{lost.text}</b> : null}
      </div>
      {group.items.map(({ difference, index }) => (
        <button key={`${difference.kind}-${difference.sM}`} type="button" className="diff" aria-pressed={selected === index} onClick={() => onSelect(index)}>
          <span className="diff-at">
            {metres(difference.sM)}
          </span>{' '}
          <span className="diff-text">{describe(difference)}</span>
        </button>
      ))}
      {group.items.length === 0 && emptyText ? <p className="diff diff-none">{emptyText}</p> : null}
    </div>
  );
}

function TurnSort({ header }: { header(column: TurnOrder): SortBinding }) {
  return (
    <div className="turn-sort" role="table">
      <div className="turn-sort-row" role="row">
        <SortHeader label={t('exercises.compare.sort-turn')} {...header('track')} />
        <SortHeader label={t('exercises.compare.sort-time-lost')} {...header('time-lost')} />
      </div>
    </div>
  );
}

export type DifferencesWords = { intro: string; none: string; emptyTurn: string | null; orderSwitch: boolean; neutralSmall: boolean; allTurns: boolean; wholeLabel: string; describe(difference: Difference): string };

export function reviewDifferences(): DifferencesWords {
  return {
    intro: t('exercises.compare.intro'),
    none: t('exercises.compare.none'),
    emptyTurn: null,
    orderSwitch: true,
    neutralSmall: false,
    allTurns: false,
    wholeLabel: t('exercises.compare.whole'),
    describe: differenceText
  };
}

type DifferencesProps = { findings: Difference[]; losses: TurnLossInfo[]; selected: number | null; words: DifferencesWords; onSelect(index: number): void; scroll?: boolean };

function useSelectedInView(scroll: boolean, selected: number | null) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = list.current;
    if (!scroll || !box || selected === null) return;
    const item = box.querySelector<HTMLElement>('.diff[aria-pressed="true"]');
    if (!item) return;
    const outer = box.getBoundingClientRect();
    const inner = item.getBoundingClientRect();
    if (inner.top < outer.top) box.scrollTop += inner.top - outer.top;
    else if (inner.bottom > outer.bottom) box.scrollTop += inner.bottom - outer.bottom;
  }, [scroll, selected]);
  return list;
}

export const Differences = memo(function Differences({ findings, losses, selected, words, onSelect, scroll = false }: DifferencesProps) {
  const list = useSelectedInView(scroll, selected);
  const sort = useSort(TURN_ORDER_DIRECTIONS, 'track');
  const groups = groupByTurn(findings, losses, sort.column, words.allTurns, sort.direction);
  return (
    <section className="differences">
      <h2>{t('exercises.compare.title')}</h2>
      <p className="sub">{words.intro}</p>
      {findings.length === 0 ? <p className="notice">{words.none}</p> : null}
      {words.orderSwitch && groups.length > 1 ? <TurnSort header={sort.header} /> : null}
      <div ref={list} className={scroll ? 'turn-groups scrolls' : 'turn-groups'}>
        {groups.map(group => (
          <TurnGroupList key={group.turn ?? 'whole'} group={group} selected={selected} neutralSmall={words.neutralSmall} emptyText={words.emptyTurn} wholeLabel={words.wholeLabel} describe={words.describe} onSelect={onSelect} />
        ))}
      </div>
    </section>
  );
});

type MapScale = 'true' | 'side';

function sidePeaks(review: LineComparison): TrackPeak[] {
  return largestSideInZones(review.corners, review.attempt.lat, review.gridM).map(peak => {
    const parts = { turn: t('charts.turn.badge', { turn: peak.turn }), metres: Math.abs(peak.lat).toFixed(1), side: peak.lat < 0 ? t('exercises.compare.left') : t('exercises.compare.right'), place: metres(peak.sM) };
    return {
      turn: peak.turn,
      sM: peak.sM,
      title: t('exercises.compare.callout', parts),
      detail: t('exercises.compare.callout-at', parts)
    };
  });
}

function MapSwitch({ scale, onScale }: { scale: MapScale; onScale(scale: MapScale): void }) {
  return (
    <div className="map-switch">
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
  const peaks = useMemo(() => (side ? sidePeaks(review) : []), [side, review]);
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
  return (
    <MapPanel
      {...(words.mapTitle ? { title: words.mapTitle } : {})}
      legend={['reference', 'you', 'turn']}
      legendTexts={{ reference: words.referenceLegend, you: words.youLegend }}
      far={side && sideCueDistanceM !== null ? t('exercises.compare.far', { metres: sideCueDistanceM }) : null}
      notes={words.mapNotes}
      actions={scaleSwitch ? <MapSwitch scale={scale} onScale={setScale} /> : null}
      onView={() => setViewing(true)}
    >
      <div className="review-map">
        <TrackMap reference={reference} attempt={sideAttempt ?? trueAttempt} far={far} peaks={peaks} cursorSM={cursorSM} marks={marks} lapLine={lapLine} />
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
        lineName={words.dialogLine}
        lapLine={lapLine}
        metresText={words.metres}
      />
    </MapPanel>
  );
}
