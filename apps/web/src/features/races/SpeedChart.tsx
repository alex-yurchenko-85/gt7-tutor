import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import { KPH_PER_MPS, type RaceDetail, type RaceLapsSpeed } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { ChannelChart, ChartSwatch, type ChartBand, type ChartBoxRow, type ChartSeries, type ChartTick } from '../../charts/ChannelChart.tsx';
import { labelledTicks } from '../../charts/ticks.ts';
import { useFrameCursor } from '../../charts/use-frame-cursor.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { Icon } from '../../app/icons.tsx';
import { speedRange } from './speed-range.ts';
import { isRawMissing, rawMissingText } from './race-errors.ts';
import { SpeedDialog } from './SpeedDialog.tsx';
import { t } from '../../app/i18n.ts';

export const SPEED_HEIGHT = 300;
const SPEED_TICK_COUNT = 4;

const LAP_COLOURS = 10;

type SpeedLine = { number: number; kph: (number | null)[]; colour: number; best: boolean };

type SpeedData = { lines: SpeedLine[]; bands: ChartBand[]; min: number; max: number; ticks: ChartTick[] };

function lapColour(lap: number): number {
  return (((lap - 1) % LAP_COLOURS) + LAP_COLOURS) % LAP_COLOURS;
}

function speedData(speed: RaceLapsSpeed, bestLap: number): SpeedData {
  const lines = speed.laps
    .map(lap => ({ number: lap.number, kph: lap.v.map(value => (value === null ? null : value * KPH_PER_MPS)), colour: lapColour(lap.number), best: lap.number === bestLap }))
    .sort((a, b) => a.number - b.number);
  const range = speedRange(lines.map(line => line.kph));
  const min = range ? range.min * 0.9 : 0;
  const max = range ? range.max * 1.05 : 1;
  return {
    lines,
    bands: speed.turns.map(turn => ({ fromSM: turn.fromSM, toSM: turn.toSM, label: t('charts.turn.badge', { turn: turn.turn }) })),
    min,
    max,
    ticks: labelledTicks(min, max, SPEED_TICK_COUNT)
  };
}

function kphAt(line: SpeedLine, index: number): number | null {
  const value = line.kph[Math.min(line.kph.length - 1, index)];
  return value === null || value === undefined ? null : Math.round(value);
}

function speedBox(lines: SpeedLine[], index: number): ChartBoxRow[] {
  return lines.map(line => {
    const value = kphAt(line, index);
    const speed = value === null ? t('races.speed.no-data') : t('app.unit.kph', { value });
    return { key: String(line.number), tone: 'lap', colour: line.colour, strong: line.best, text: t('races.speed.box-lap', { lap: line.number, speed }) };
  });
}

function speedSeries(lines: SpeedLine[]): ChartSeries[] {
  const order = [...lines.filter(line => !line.best), ...lines.filter(line => line.best)];
  return order.map(line => ({ name: 'lap', values: line.kph, colour: line.colour, strong: line.best }));
}

type LapLegendProps = { lines: SpeedLine[]; hidden: ReadonlySet<number>; onToggle(lap: number): void };

const LapLegend = memo(function LapLegend({ lines, hidden, onToggle }: LapLegendProps) {
  return (
    <div className="lap-legend">
      {lines.map(line => {
        const shown = !hidden.has(line.number);
        return (
          <button key={line.number} type="button" className={shown ? 'speed-lap-key' : 'speed-lap-key off'} aria-pressed={shown} onClick={() => onToggle(line.number)}>
            <ChartSwatch tone="lap" colour={line.colour} strong={line.best} />
            {t('races.speed.legend-lap', { lap: line.number })}
          </button>
        );
      })}
      <span className="turn-key">
        <i className="race-mark turn" />
        {t('races.speed.legend-turn')}
      </span>
    </div>
  );
});

export type LapSelection = { hidden: ReadonlySet<number>; toggle(lap: number): void };

function useLapSelection(): LapSelection {
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set());
  const toggle = useCallback((lap: number) => {
    setHidden(current => {
      const next = new Set(current);
      if (!next.delete(lap)) next.add(lap);
      return next;
    });
  }, []);
  return { hidden, toggle };
}

type SpeedChartProps = { id: string; speed: RaceLapsSpeed; bestLap: number; selection: LapSelection; height: number; action?: ReactNode };

export function SpeedChart({ id, speed, bestLap, selection, height, action }: SpeedChartProps) {
  const data = useMemo(() => speedData(speed, bestLap), [speed, bestLap]);
  const visible = useMemo(() => data.lines.filter(line => !selection.hidden.has(line.number)), [data.lines, selection.hidden]);
  const series = useMemo(() => speedSeries(visible), [visible]);
  const [cursorSM, setCursor, scrub] = useFrameCursor();
  const index = Math.round(cursorSM / speed.gridM);
  const box = speedBox(visible, index);
  return (
    <>
      <div className="charts">
        <ChannelChart
          id={id}
          series={series}
          min={data.min}
          max={data.max}
          gridM={speed.gridM}
          lengthM={speed.lengthM}
          cursorSM={cursorSM}
          onCursor={setCursor}
          onScrub={scrub}
          ticks={data.ticks}
          height={height}
          bands={data.bands}
          turnLabels="fit"
          field={{ title: null, unit: t('races.speed.unit') }}
          box={box}
          {...(action ? { fieldAction: action } : {})}
        />
      </div>
      <LapLegend lines={data.lines} hidden={selection.hidden} onToggle={selection.toggle} />
    </>
  );
}

export function SpeedSection({ race }: { race: RaceDetail }) {
  const speed = useResource(() => api.raceSpeed(race.id), [race.id]);
  const selection = useLapSelection();
  const [viewing, setViewing] = useState(false);
  const bestLap = race.laps.some(lap => lap.number === race.bestLap) ? race.bestLap : race.referenceLap;
  const view = (
    <button type="button" className="icon-button speed-view" onClick={() => setViewing(true)}>
      <Icon name="expand" size={16} />
      {t('races.speed.view')}
    </button>
  );
  return (
    <section className="race-speed">
      <h2>{t('races.speed.title')}</h2>
      {speed.data ? (
        <>
          <SpeedChart id="race-speed" speed={speed.data} bestLap={bestLap} selection={selection} height={SPEED_HEIGHT} action={view} />
          <SpeedDialog open={viewing} onClose={() => setViewing(false)} race={race} speed={speed.data} bestLap={bestLap} selection={selection} />
        </>
      ) : speed.error ? (
        <p className={isRawMissing(speed.error) ? 'sub race-speed-note' : 'error race-speed-note'}>
          {isRawMissing(speed.error) ? rawMissingText() : errorText(speed.error)}
        </p>
      ) : (
        <p className="sub race-speed-wait">{t('races.speed.reading')}</p>
      )}
    </section>
  );
}
