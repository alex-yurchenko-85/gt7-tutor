import type { KeyboardEvent, PointerEvent } from 'react';
import { WIDTH, percent, rounded } from './geometry.ts';
import { usePlotWidth } from './use-plot-width.ts';
import './charts.css';

type RaceTimePoint = { tMs: number; value: number };

export type RacePitBand = { fromMs: number; toMs: number };

export type RaceTimeCursor = {
  tMs: number;
  active: boolean;
  value: number | null;
  box: string[];
  valueText: string;
  snapMs: number[];
  onCursor(tMs: number): void;
  onActive(source: 'pointer' | 'focus', active: boolean): void;
};

type RaceTimeChartProps = {
  label: string;
  raceMs: number;
  firstLap: number;
  lapEnds: number[];
  pitStops: RacePitBand[];
  points: RaceTimePoint[];
  step: boolean;
  min: number;
  max: number;
  ticks: number[];
  tone: 'ink' | 'ref';
  height?: number;
  bold?: number[];
  cursor?: RaceTimeCursor;
};

const DEFAULT_HEIGHT = 140;
const EDGE = 4;
const BOLD_CLEARANCE_PX = 14;
const CHAR_PX = 7;
const LABEL_GAP_PX = 4;
const NO_BOLD: number[] = [];
const SNAP_PX = 12;
const BOX_SIDE_SHARE = 0.5;

type AxisLabel = { key: string; text: string; at: number; pit: boolean };

function labelStep(laps: number): number {
  if (laps <= 10) return 1;
  return laps <= 20 ? 2 : 5;
}

function touches(a: AxisLabel, b: AxisLabel, plotWidth: number): boolean {
  const widthOf = (label: AxisLabel) => (label.text.length + (label.pit ? 1 : 0)) * CHAR_PX;
  return Math.abs(a.at - b.at) * plotWidth < (widthOf(a) + widthOf(b)) / 2 + LABEL_GAP_PX;
}

export function RaceTimeChart({ label, raceMs, firstLap, lapEnds, pitStops, points, step, min, max, ticks, tone, height = DEFAULT_HEIGHT, bold = NO_BOLD, cursor }: RaceTimeChartProps) {
  const [plotRef, plotWidth] = usePlotWidth();
  const span = raceMs > 0 ? raceMs : 1;
  const toX = (tMs: number) => rounded((Math.max(0, Math.min(span, tMs)) / span) * WIDTH);
  const toY = (value: number) => rounded(EDGE + ((max - value) / (max - min || 1)) * (height - 2 * EDGE));
  const path = points
    .map((point, index) => {
      if (index === 0) return `M${toX(point.tMs)} ${toY(point.value)}`;
      return step ? `H${toX(point.tMs)}V${toY(point.value)}` : `L${toX(point.tMs)} ${toY(point.value)}`;
    })
    .join('');
  const last = points.at(-1);
  const line = step && last ? `${path}H${WIDTH}` : path;
  const fromPointer = (event: PointerEvent<HTMLDivElement>, active: RaceTimeCursor) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const tMs = Math.max(0, Math.min(span, ((event.clientX - box.left) / box.width) * span));
    const nearest = active.snapMs.reduce<number | null>((best, at) => (best === null || Math.abs(at - tMs) < Math.abs(best - tMs) ? at : best), null);
    active.onCursor(nearest !== null && (Math.abs(nearest - tMs) / span) * box.width <= SNAP_PX ? nearest : tMs);
  };
  const fromKey = (event: KeyboardEvent<HTMLDivElement>, active: RaceTimeCursor) => {
    const next = active.snapMs.find(at => at > active.tMs);
    const previous = active.snapMs.findLast(at => at < active.tMs);
    const targets: Record<string, number | undefined> = { ArrowRight: next, ArrowUp: next, ArrowLeft: previous ?? 0, ArrowDown: previous ?? 0, Home: 0, End: span };
    if (!(event.key in targets)) return;
    event.preventDefault();
    active.onActive('focus', true);
    const target = targets[event.key];
    if (target !== undefined) active.onCursor(target);
  };
  const lapStarts = [0, ...lapEnds.slice(0, -1)];
  const every = labelStep(lapEnds.length);
  const yLabels = [
    ...ticks.filter(tick => !bold.some(value => value === tick || Math.abs(toY(value) - toY(tick)) < BOLD_CLEARANCE_PX)).map(tick => ({ value: tick, bold: false })),
    ...bold.filter((value, index) => bold.indexOf(value) === index).map(value => ({ value, bold: true }))
  ];
  const pitLabels: AxisLabel[] = pitStops.map((pit, index) => ({ key: `pit-${pit.fromMs}`, text: `P${index + 1}`, at: (pit.fromMs + pit.toMs) / 2 / span, pit: true }));
  const lapLabels: AxisLabel[] = lapStarts
    .map((start, index) => ({ key: `lap-${start}`, text: String(firstLap + index), at: (start + (lapEnds[index]! - start) / 2) / span, pit: false }))
    .filter((lap, index) => index === 0 || Number(lap.text) % every === 0)
    .filter(lap => !pitLabels.some(pit => touches(lap, pit, plotWidth)));
  return (
    <div className="race-chart chart-field" {...(cursor ? {} : { role: 'group', 'aria-label': label })}>
      <div className="channel-body">
        <div className="y-axis" aria-hidden="true">
          {yLabels.map(item => (
            <span key={`${item.bold ? 'b' : 't'}${item.value}`} className={item.bold ? 'axis-bold' : undefined} style={{ top: percent(toY(item.value) / height) }}>
              {item.value}
            </span>
          ))}
        </div>
        <div
          ref={plotRef}
          className={cursor ? 'plot race-chart-plot race-chart-active' : 'plot race-chart-plot'}
          {...(cursor
            ? {
                role: 'slider',
                tabIndex: 0,
                'aria-label': label,
                'aria-valuemin': 0,
                'aria-valuemax': Math.round(span),
                'aria-valuenow': Math.round(cursor.tMs),
                'aria-valuetext': cursor.valueText,
                onPointerDown: (event: PointerEvent<HTMLDivElement>) => fromPointer(event, cursor),
                onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
                  if (event.buttons > 0 || event.pointerType === 'mouse') fromPointer(event, cursor);
                },
                onPointerEnter: () => cursor.onActive('pointer', true),
                onPointerLeave: (event: PointerEvent<HTMLDivElement>) => {
                  if (event.pointerType !== 'touch') cursor.onActive('pointer', false);
                },
                onFocus: () => cursor.onActive('focus', true),
                onBlur: () => cursor.onActive('focus', false),
                onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => fromKey(event, cursor)
              }
            : {})}
        >
          <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" style={{ height }} aria-hidden="true">
            {pitStops.map(pit => (
              <rect key={pit.fromMs} className="race-chart-pit" x={toX(pit.fromMs)} width={Math.max(1, toX(pit.toMs) - toX(pit.fromMs))} y={0} height={height} />
            ))}
            {ticks.map(tick => (
              <line key={tick} className="chart-grid" x1={0} x2={WIDTH} y1={toY(tick)} y2={toY(tick)} />
            ))}
            {lapEnds.slice(0, -1).map(end => (
              <line key={end} className="race-chart-lap" x1={toX(end)} x2={toX(end)} y1={0} y2={height} />
            ))}
            {line ? <path className={`chart-line ${tone}`} d={line} /> : null}
          </svg>
          {step && last ? <span className="race-chart-end" aria-hidden="true" style={{ top: percent(toY(last.value) / height) }} /> : null}
          {cursor?.active ? <CursorMarks cursor={cursor} share={Math.max(0, Math.min(span, cursor.tMs)) / span} valueShare={cursor.value === null ? null : toY(cursor.value) / height} /> : null}
        </div>
      </div>
      <div className="race-chart-laps" aria-hidden="true">
        <b className="axis-name">lap</b>
        <div>
          {[...lapLabels, ...pitLabels].map(item => (
            <span key={item.key} className={item.pit ? 'axis-pit' : undefined} style={{ left: percent(item.at) }}>
              {item.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function CursorMarks({ cursor, share, valueShare }: { cursor: RaceTimeCursor; share: number; valueShare: number | null }) {
  const below = valueShare === null || valueShare < BOX_SIDE_SHARE;
  return (
    <>
      <i className="race-cursor-line" aria-hidden="true" style={{ left: percent(share) }} />
      {valueShare === null ? null : <i className="race-cursor-dot" aria-hidden="true" style={{ left: percent(share), top: percent(valueShare) }} />}
      <div
        className={['race-cursor-box', share > BOX_SIDE_SHARE ? 'left' : 'right', below ? 'below' : 'above'].join(' ')}
        aria-hidden="true"
        style={{ left: percent(share), top: percent(valueShare ?? 0) }}
      >
        {cursor.box.map((line, index) => (index === 0 ? <b key={line}>{line}</b> : <span key={line}>{line}</span>))}
      </div>
    </>
  );
}

