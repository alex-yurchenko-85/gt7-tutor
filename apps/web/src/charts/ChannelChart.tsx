import { memo, type KeyboardEvent, type PointerEvent } from 'react';
import { WIDTH, seriesSegments } from './geometry.ts';
import { distanceTicks } from './ticks.ts';
import './charts.css';

export type ChartSeries = { name: 'ref' | 'you' | 'ink'; values: (number | null)[] };

export type ChartBand = { fromSM: number; toSM: number; label: string };

export type ChartTick = { value: number; label: string };

type ChannelChartProps = {
  id: string;
  label: string;
  series: ChartSeries[];
  min: number;
  max: number;
  gridM: number;
  lengthM: number;
  cursorSM: number;
  onCursor(sM: number): void;
  onScrub?(sM: number): void;
  readout: string;
  ticks: ChartTick[];
  height?: number;
  bands?: ChartBand[];
  turnLabels?: boolean;
};

const CHART_HEIGHT = 120;
const NO_BANDS: ChartBand[] = [];

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

const DistanceAxis = memo(function DistanceAxis({ lengthM, bands, turnLabels }: { lengthM: number; bands: ChartBand[]; turnLabels: boolean }) {
  return (
    <div className="distance-axis" aria-hidden="true">
      <div>
        {distanceTicks(lengthM).map(tick => (
          <span key={tick} className={tick === 0 ? 'axis-start' : undefined} style={{ left: percent(tick / lengthM) }}>
            {tick === 0 ? '0 m' : tick}
          </span>
        ))}
        {turnLabels
          ? bands.map(band => (
              <b key={band.label} style={{ left: percent((band.fromSM + band.toSM) / 2 / lengthM) }}>
                {band.label}
              </b>
            ))
          : null}
      </div>
    </div>
  );
});

type PlotLayerProps = Pick<ChannelChartProps, 'series' | 'ticks' | 'bands' | 'min' | 'max' | 'gridM' | 'lengthM'> & { height: number };

const PlotLayer = memo(function PlotLayer({ series, ticks, bands = [], min, max, gridM, lengthM, height }: PlotLayerProps) {
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
      {zeroY === null ? null : <line className="chart-zero" x1={0} x2={WIDTH} y1={zeroY} y2={zeroY} />}
      {series.map(item =>
        seriesSegments(item.values, toX, toY).map((points, index) => (
          <polyline key={`${item.name}-${index}`} className={`chart-line ${item.name}`} data-series={item.name} points={points} />
        ))
      )}
    </>
  );
});

export function ChannelChart({ id, label, series, min, max, gridM, lengthM, cursorSM, onCursor, onScrub = onCursor, readout, ticks, height = CHART_HEIGHT, bands = NO_BANDS, turnLabels = false }: ChannelChartProps) {
  const span = max - min || 1;
  const toY = (value: number) => height - 4 - ((value - min) / span) * (height - 8);
  const cursorX = (cursorSM / lengthM) * WIDTH;
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
  return (
    <div className="channel">
      <div className="channel-label">
        <span id={`${id}-label`}>{label}</span>
        <span>{readout}</span>
      </div>
      <div className="channel-body">
        <div className="y-axis" aria-hidden="true">
          {ticks.map(tick => (
            <span key={tick.value} style={{ top: percent(toY(tick.value) / height) }}>
              {tick.label}
            </span>
          ))}
        </div>
        <div
          className="plot channel-plot"
          data-chart={id}
          role="slider"
          tabIndex={0}
          aria-labelledby={`${id}-label`}
          aria-valuemin={0}
          aria-valuemax={Math.round(lengthM)}
          aria-valuenow={Math.round(cursorSM)}
          aria-valuetext={`${Math.round(cursorSM)} m. ${readout}`}
          onPointerDown={event => fromPointer(event, onCursor)}
          onPointerMove={event => {
            if (event.buttons > 0 || event.pointerType === 'mouse') fromPointer(event, onScrub);
          }}
          onKeyDown={fromKey}
        >
          <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" style={{ height }} aria-hidden="true">
            <PlotLayer series={series} ticks={ticks} bands={bands} min={min} max={max} gridM={gridM} lengthM={lengthM} height={height} />
            <line className="chart-cursor" x1={cursorX.toFixed(1)} x2={cursorX.toFixed(1)} y1={0} y2={height} />
          </svg>
        </div>
      </div>
      <DistanceAxis lengthM={lengthM} bands={bands} turnLabels={turnLabels} />
    </div>
  );
}
