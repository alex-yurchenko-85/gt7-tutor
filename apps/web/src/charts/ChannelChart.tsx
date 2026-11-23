import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { WIDTH, percent, seriesSegments } from './geometry.ts';
import { usePlotWidth } from './use-plot-width.ts';
import { distanceTicks } from './ticks.ts';
import { LABEL_ROW_STEP_PX, LABEL_TOP_PX, turnLabelPlaces } from './turn-labels.ts';
import './charts.css';
import { groupedMetres } from '../app/format.ts';
import { BOX_EDGE_PX, boxColumns, boxLeft, type BoxSide } from './box-place.ts';
import { t } from '../app/i18n.ts';

export type ChartSeries = { name: 'ref' | 'you' | 'ink' | 'lap'; values: (number | null)[]; colour?: number; strong?: boolean };

export type ChartBand = { fromSM: number; toSM: number; label: string };

export type ChartRing = { sM: number; value: number; tone: 'ref' | 'you'; label: string | null; side: 'left' | 'right'; place: 'above' | 'below' };

export type ChartTick = { value: number; label: string; tone?: 'ref' };

export type ChartField = { title: string | null; unit: string | null };

export type ChartBoxRow = { key: string; tone: ChartSeries['name']; text: string; colour?: number; strong?: boolean };

type ChannelChartProps = {
  id: string;
  label?: string;
  series: ChartSeries[];
  min: number;
  max: number;
  gridM: number;
  lengthM: number;
  cursorSM: number;
  onCursor(sM: number): void;
  onScrub?(sM: number): void;
  readout?: string;
  ticks: ChartTick[];
  height?: number;
  bands?: ChartBand[];
  turnLabels?: boolean | 'fit';
  marks?: number[];
  rings?: ChartRing[];
  area?: boolean;
  legend?: ReactNode;
  box?: ChartBoxRow[];
  field?: ChartField;
  fieldAction?: ReactNode;
};

const CHART_HEIGHT = 120;
const BOX_SIDE_SHARE = 0.5;
const BOX_ROWS = 8;
const BOX_MAX_COLUMNS = 4;
const BOX_COLUMN_GAP_PX = 16;
const NO_BANDS: ChartBand[] = [];
const NO_MARKS: number[] = [];
const NO_RINGS: ChartRing[] = [];
const RING_EDGE_SHARE = 0.15;
const RING_LOW_SHARE = 0.8;
const RING_HIGH_SHARE = 0.2;

function ringSide(side: ChartRing['side'], x: number): ChartRing['side'] {
  if (side === 'right' && x > 1 - RING_EDGE_SHARE) return 'left';
  if (side === 'left' && x < RING_EDGE_SHARE) return 'right';
  return side;
}

function ringPlace(place: ChartRing['place'], y: number): ChartRing['place'] {
  if (place === 'below' && y > RING_LOW_SHARE) return 'above';
  if (place === 'above' && y < RING_HIGH_SHARE) return 'below';
  return place;
}
const DistanceAxis = memo(function DistanceAxis({ lengthM }: { lengthM: number }) {
  return (
    <div className="distance-axis">
      <div>
        {distanceTicks(lengthM).map(tick => (
          <span key={tick} className={tick === 0 ? 'axis-start' : undefined} style={{ left: percent(tick / lengthM) }}>
            {tick === 0 ? t('app.unit.metres', { value: 0 }) : tick}
          </span>
        ))}
      </div>
    </div>
  );
});

function areaPoints(points: string, zeroY: number): string {
  const list = points.split(' ');
  const x = (point: string) => point.split(',')[0];
  return `${points} ${x(list.at(-1)!)},${zeroY} ${x(list[0]!)},${zeroY}`;
}

type PlotLayerProps = Pick<ChannelChartProps, 'series' | 'ticks' | 'bands' | 'marks' | 'area' | 'min' | 'max' | 'gridM' | 'lengthM'> & { height: number };

const PlotLayer = memo(function PlotLayer({ series, ticks, bands = [], marks = NO_MARKS, area = false, min, max, gridM, lengthM, height }: PlotLayerProps) {
  const span = max - min || 1;
  const toX = (index: number) => ((index * gridM) / lengthM) * WIDTH;
  const toY = (value: number) => height - 4 - ((value - min) / span) * (height - 8);
  const zeroY = min < 0 && max > 0 ? toY(0) : null;
  return (
    <>
      {bands.map(band => (
        <rect
          key={band.label}
          className="chart-band"
          data-band={band.label}
          x={((band.fromSM / lengthM) * WIDTH).toFixed(1)}
          width={(((band.toSM - band.fromSM) / lengthM) * WIDTH).toFixed(1)}
          y={0}
          height={height}
        />
      ))}
      {ticks.map(tick => (
        <line key={tick.value} className="chart-grid" x1={0} x2={WIDTH} y1={toY(tick.value)} y2={toY(tick.value)} />
      ))}
      {marks.map(value => (
        <line key={value} className="chart-threshold" x1={0} x2={WIDTH} y1={toY(value)} y2={toY(value)} />
      ))}
      {zeroY === null ? null : <line className="chart-zero" x1={0} x2={WIDTH} y1={zeroY} y2={zeroY} />}
      {series.map((item, seriesIndex) =>
        seriesSegments(item.values, toX, toY).map((points, index) => (
          <Fragment key={`${seriesIndex}-${item.name}-${index}`}>
            {area && item.name === 'you' ? <polygon className="chart-area" points={areaPoints(points, toY(0))} /> : null}
            <polyline className={`chart-line ${item.name}${item.strong ? ' strong' : ''}`} data-series={item.name} data-colour={item.colour} style={seriesColour(item.colour)} points={points} />
          </Fragment>
        ))
      )}
    </>
  );
});

type CursorDot = { key: string; top: number };

function cursorDots(series: ChartSeries[], index: number, toY: (value: number) => number, height: number): CursorDot[] {
  return series.flatMap((item, seriesIndex) => {
    const value = item.values[Math.min(item.values.length - 1, index)];
    return value === null || value === undefined ? [] : [{ key: `${seriesIndex}-${item.name}`, top: toY(value) / height }];
  });
}

function seriesColour(colour: number | undefined): CSSProperties | undefined {
  return colour === undefined ? undefined : ({ '--series': `var(--lap-${colour})` } as CSSProperties);
}

export function ChartSwatch({ tone, colour, strong = false }: { tone: ChartSeries['name']; colour?: number | undefined; strong?: boolean | undefined }) {
  return <i className={`chart-swatch ${tone}${strong ? ' strong' : ''}`} data-colour={colour} style={seriesColour(colour)} />;
}

type CursorBoxProps = { rows: ChartBoxRow[]; title: string; share: number; dots: CursorDot[]; underLabels: boolean };

function plotWidthOf(box: HTMLElement): number {
  return box.parentElement?.clientWidth ?? 0;
}

function fitColumns(box: HTMLElement, list: HTMLElement, columns: number) {
  const plotWidth = plotWidthOf(box);
  if (plotWidth <= 0) return;
  list.style.setProperty('--box-columns', String(columns));
  box.style.left = '0px';
  box.style.maxWidth = 'none';
  const chrome = box.offsetWidth - list.offsetWidth;
  const columnWidth = (list.offsetWidth + BOX_COLUMN_GAP_PX) / columns;
  const fit = boxColumns(columns, columnWidth, plotWidth - 2 * BOX_EDGE_PX - chrome + BOX_COLUMN_GAP_PX);
  if (fit < columns) list.style.setProperty('--box-columns', String(fit));
  box.style.maxWidth = '';
}

function placeBox(box: HTMLElement, share: number, side: BoxSide) {
  const plotWidth = plotWidthOf(box);
  if (plotWidth <= 0) return;
  box.style.left = `${boxLeft(share * plotWidth, side, plotWidth, box.offsetWidth)}px`;
}

function CursorBox({ rows, title, share, dots, underLabels }: CursorBoxProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const middle = dots.length === 0 ? 1 : dots.reduce((sum, dot) => sum + dot.top, 0) / dots.length;
  const place = middle < 0.5 ? 'low' : underLabels ? 'high labels' : 'high';
  const side: BoxSide = share > BOX_SIDE_SHARE ? 'left' : 'right';
  const columns = Math.min(BOX_MAX_COLUMNS, Math.ceil(rows.length / BOX_ROWS));
  useLayoutEffect(() => {
    if (boxRef.current && listRef.current) fitColumns(boxRef.current, listRef.current, columns);
  }, [columns, rows.length]);
  useLayoutEffect(() => {
    if (boxRef.current) placeBox(boxRef.current, share, side);
  });
  return (
    <div ref={boxRef} className={['chart-box', side, place].join(' ')} style={{ left: percent(share) }}>
      <b className="chart-box-title">{title}</b>
      <ul ref={listRef} style={{ '--box-columns': columns } as CSSProperties}>
        {rows.map(row => (
          <li key={row.key}>
            <ChartSwatch tone={row.tone} colour={row.colour} strong={row.strong} />
            {row.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChannelChart({ id, label, series, min, max, gridM, lengthM, cursorSM, onCursor, onScrub = onCursor, readout, ticks, height = CHART_HEIGHT, bands = NO_BANDS, turnLabels = false, marks = NO_MARKS, rings = NO_RINGS, area = false, legend = null, box, field, fieldAction = null }: ChannelChartProps) {
  const zones = useMemo(() => bands.filter(band => band.toSM > band.fromSM), [bands]);
  const span = max - min || 1;
  const toY = (value: number) => height - 4 - ((value - min) / span) * (height - 8);
  const [plotRef, plotWidth] = usePlotWidth(turnLabels !== false);
  const cursorX = (cursorSM / lengthM) * WIDTH;
  const share = lengthM > 0 ? Math.max(0, Math.min(1, cursorSM / lengthM)) : 0;
  const [pointerOver, setPointerOver] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!pointerOver) return;
    const away = (event: globalThis.PointerEvent) => {
      if (!plotRef.current?.contains(event.target as Node)) setPointerOver(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [pointerOver, plotRef]);
  const dots = cursorDots(series, Math.round(cursorSM / gridM), toY, height);
  const turn = zones.find(band => cursorSM >= band.fromSM && cursorSM <= band.toSM);
  const boxTitle = turn ? `${groupedMetres(cursorSM)} · ${turn.label}` : groupedMetres(cursorSM);
  const clamp = (sM: number) => Math.max(0, Math.min(lengthM, sM));
  const fromPointer = (event: PointerEvent<HTMLDivElement>, report: (sM: number) => void) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    report(clamp(Math.round((((event.clientX - box.left) / box.width) * lengthM) / gridM) * gridM));
  };
  const fromKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = { ArrowRight: gridM, ArrowLeft: -gridM, PageUp: gridM * 10, PageDown: -gridM * 10 };
    if (event.key === 'Home') onCursor(0);
    else if (event.key === 'End') onCursor(lengthM);
    else if (event.key in steps) onCursor(clamp(cursorSM + steps[event.key]!));
    else return;
    event.preventDefault();
  };
  const labelRow = (
    <div className="channel-label">
      {field || !label ? null : <span>{label}</span>}
      {field?.title ? (
        <b className="field-title">
          {field.title}
        </b>
      ) : null}
      {box || readout === undefined ? null : <span className="channel-readout">{readout}</span>}
    </div>
  );
  const body = (
    <div className="channel-body">
      <div className="y-axis">
        {ticks.map(tick => (
          <span key={tick.value} className={tick.tone === 'ref' ? 'tone-ref' : undefined} style={{ top: percent(toY(tick.value) / height) }}>
            {tick.label}
          </span>
        ))}
      </div>
      <div
        ref={plotRef}
        className="plot channel-plot"
        data-chart={id}
        role="slider"
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={Math.round(lengthM)}
        aria-valuenow={Math.round(cursorSM)}
        onPointerDown={event => fromPointer(event, onCursor)}
        onPointerMove={event => {
          if (event.buttons > 0 || event.pointerType === 'mouse') fromPointer(event, onScrub);
        }}
        onPointerEnter={() => setPointerOver(true)}
        onPointerLeave={event => {
          if (event.pointerType === 'touch') return;
          setPointerOver(false);
          setFocused(false);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={event => {
          setFocused(true);
          fromKey(event);
        }}
      >
        <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" style={{ height }}>
          <PlotLayer series={series} ticks={ticks} bands={zones} marks={marks} area={area} min={min} max={max} gridM={gridM} lengthM={lengthM} height={height} />
          <line className="chart-cursor" x1={cursorX.toFixed(1)} x2={cursorX.toFixed(1)} y1={0} y2={height} />
        </svg>
        {rings.map((ring, index) => {
          const x = ring.sM / lengthM;
          const y = toY(ring.value) / height;
          return (
            <i key={`${index}-${ring.tone}`} className="chart-ring" data-tone={ring.tone} data-side={ringSide(ring.side, x)} data-label={ringPlace(ring.place, y)} style={{ left: percent(x), top: percent(y) }}>
              {ring.label === null ? null : <span>{ring.label}</span>}
            </i>
          );
        })}
        {dots.map(dot => (
          <i key={dot.key} className="chart-dot" style={{ left: percent(share), top: percent(dot.top) }} />
        ))}
        {turnLabels
          ? turnLabelPlaces(zones, lengthM, plotWidth, turnLabels === 'fit').map(place => (
              <b
                key={place.label}
                className="turn-label"
                style={{ left: percent(place.centre / plotWidth), top: LABEL_TOP_PX + place.row * LABEL_ROW_STEP_PX }}
              >
                {place.label}
              </b>
            ))
          : null}
        {box && box.length > 0 && (pointerOver || focused) ? <CursorBox rows={box} title={boxTitle} share={share} dots={dots} underLabels={turnLabels !== false} /> : null}
      </div>
    </div>
  );
  if (!field) {
    return (
      <div className="channel">
        {legend}
        {labelRow}
        {body}
        <DistanceAxis lengthM={lengthM} />
      </div>
    );
  }
  const unit = field.unit ? <span className="field-unit">{field.unit}</span> : null;
  return (
    <div className="channel in-field">
      {legend}
      <div className="chart-field">
        {labelRow}
        {fieldAction ? (
          <div className="field-head">
            {unit}
            {fieldAction}
          </div>
        ) : (
          unit
        )}
        {body}
        <DistanceAxis lengthM={lengthM} />
      </div>
    </div>
  );
}
