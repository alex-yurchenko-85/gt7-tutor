import { Fragment, useMemo, useState } from 'react';
import { KPH_PER_MPS, type RaceDetail, type RaceLap, type RaceLapsSpeed, type RacePitStop } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { ChannelChart, type ChartBand, type ChartSeries, type ChartTick } from '../../charts/ChannelChart.tsx';
import { RaceTimeChart, type RacePitBand, type RaceTimeCursor } from '../../charts/RaceTimeChart.tsx';
import { cursorFacts, cursorSentence, fuelBox, positionBox, positionChanges } from './race-cursor.ts';
import { labelledTicks } from '../../charts/ticks.ts';
import { useFrameCursor } from '../../charts/use-frame-cursor.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { speedRange } from './speed-range.ts';
import { formatSeconds, formatTime, groupedMetres as metresText, signedSecondsText } from '../../app/format.ts';
import { isRawMissing, rawMissingText } from './race-errors.ts';
import { Icon } from '../../app/icons.tsx';
import { useWideLayout } from '../../app/layout.ts';
import { Link, paths } from '../../app/router.tsx';
import { t } from '../../app/i18n.ts';

const GAP_DIGITS = 3;
const POSITION_HEIGHT = 220;
const FUEL_HEIGHT = 140;
const FUEL_TICKS = [0, 50, 100];
const SPEED_HEIGHT = 300;
const SPEED_TICK_COUNT = 4;
const BOX_SIDE_SHARE = 0.6;
const BOX_ROWS = 8;
const BOX_MAX_COLUMNS = 4;

type SpeedLine = { number: number; kph: (number | null)[] };

type SpeedData = { best: SpeedLine | null; others: SpeedLine[]; series: ChartSeries[]; bands: ChartBand[]; min: number; max: number; ticks: ChartTick[] };


function speedData(speed: RaceLapsSpeed, bestLap: number): SpeedData {
  const lines = speed.laps.map(lap => ({ number: lap.number, kph: lap.v.map(value => (value === null ? null : value * KPH_PER_MPS)) }));
  const best = lines.find(line => line.number === bestLap) ?? null;
  const others = lines.filter(line => line !== best);
  const range = speedRange(lines.map(line => line.kph));
  const min = range ? range.min * 0.9 : 0;
  const max = range ? range.max * 1.05 : 1;
  return {
    best,
    others,
    series: [...others.map(line => ({ name: 'lap' as const, values: line.kph })), ...(best ? [{ name: 'ref' as const, values: best.kph }] : [])],
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

function speedReadout(data: SpeedData, index: number, cursorSM: number): string {
  const best = data.best ? kphAt(data.best, index) : null;
  const others = data.others.map(line => kphAt(line, index)).filter((value): value is number => value !== null);
  const noData = t('races.speed.no-data');
  const range = others.length === 0 ? noData : Math.min(...others) === Math.max(...others) ? `${others[0]}` : t('races.speed.range', { min: Math.min(...others), max: Math.max(...others) });
  return t('races.speed.readout', { place: metresText(cursorSM), best: best ?? noData, others: range });
}

function SpeedBox({ data, index, cursorSM, lengthM }: { data: SpeedData; index: number; cursorSM: number; lengthM: number }) {
  const turn = data.bands.find(band => cursorSM >= band.fromSM && cursorSM <= band.toSM);
  const share = lengthM > 0 ? cursorSM / lengthM : 0;
  const best = data.best ? kphAt(data.best, index) : null;
  const high = best !== null && best > (data.min + data.max) / 2;
  const rows = [...(data.best ? [{ line: data.best, best: true }] : []), ...data.others.map(line => ({ line, best: false }))];
  return (
    <div className={['speed-box', share > BOX_SIDE_SHARE ? 'left' : 'right', high ? 'low' : 'high'].join(' ')} style={{ left: `${(share * 100).toFixed(2)}%` }} aria-hidden="true">
      <b className="speed-box-title">{turn ? `${metresText(cursorSM)} · ${turn.label}` : metresText(cursorSM)}</b>
      <ul style={{ columnCount: Math.min(BOX_MAX_COLUMNS, Math.ceil(rows.length / BOX_ROWS)) }}>
        {rows.map(({ line, best: isBest }) => {
          const value = kphAt(line, index);
          const speed = value === null ? t('races.speed.no-data') : t('app.unit.kph', { value });
          return <li key={line.number}>{t(isBest ? 'races.speed.box-best' : 'races.speed.box-lap', { lap: line.number, speed })}</li>;
        })}
      </ul>
    </div>
  );
}

function SpeedChart({ speed, bestLap, wide }: { speed: RaceLapsSpeed; bestLap: number; wide: boolean }) {
  const data = useMemo(() => speedData(speed, bestLap), [speed, bestLap]);
  const [cursorSM, setCursor, scrub] = useFrameCursor();
  const [pointerOver, setPointerOver] = useState(false);
  const [focused, setFocused] = useState(false);
  const onActive = (source: 'pointer' | 'focus', active: boolean) => {
    if (source === 'focus') setFocused(active);
    else {
      setPointerOver(active);
      if (!active) setFocused(false);
    }
  };
  const index = Math.round(cursorSM / speed.gridM);
  return (
    <>
      <div className="charts">
        <ChannelChart
          id="race-speed"
          label={t('races.speed.label')}
          series={data.series}
          min={data.min}
          max={data.max}
          gridM={speed.gridM}
          lengthM={speed.lengthM}
          cursorSM={cursorSM}
          onCursor={setCursor}
          onScrub={scrub}
          readout={speedReadout(data, index, cursorSM)}
          ticks={data.ticks}
          height={SPEED_HEIGHT}
          bands={data.bands}
          turnLabels="fit"
          onActive={onActive}
          field={{ title: null, unit: t('races.speed.unit') }}
          overlay={wide && (pointerOver || focused) ? <SpeedBox data={data} index={index} cursorSM={cursorSM} lengthM={speed.lengthM} /> : null}
        />
      </div>
      <p className="race-legend">
        <span>
          <i className="race-mark ref" aria-hidden="true" />
          {t('races.speed.legend-best', { lap: bestLap })}
        </span>
        <span>
          <i className="race-mark lap" aria-hidden="true" />
          {t('races.speed.legend-others')}
        </span>
        <span>
          <i className="race-mark turn" aria-hidden="true" />
          {t('races.speed.legend-turn')}
        </span>
      </p>
      <p className="cursor-line" aria-live="polite">{t('races.cursor', { place: metresText(cursorSM), length: metresText(speed.lengthM) })}</p>
      <p className="sub">{t('races.speed.hint')}</p>
    </>
  );
}

function SpeedSection({ race, wide }: { race: RaceDetail; wide: boolean }) {
  const speed = useResource(() => api.raceSpeed(race.id), [race.id]);
  const bestLap = race.laps.some(lap => lap.number === race.bestLap) ? race.bestLap : race.referenceLap;
  return (
    <section className="race-speed" aria-labelledby="race-speed-title">
      <h2 id="race-speed-title">{t('races.speed.title')}</h2>
      {speed.data ? (
        <SpeedChart speed={speed.data} bestLap={bestLap} wide={wide} />
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

function gapText(lap: RaceLap, bestMs: number): string {
  return lap.timeMs === bestMs ? '' : signedSecondsText(lap.timeMs - bestMs, GAP_DIGITS);
}

function noteOf(lap: RaceLap): string | null {
  if (lap.pitIn) return t('races.laps.pit-in');
  if (lap.pitOut) return t('races.laps.pit-out');
  return null;
}

function speedText(lap: RaceLap): string {
  return t('app.unit.kph', { value: Math.round(lap.topSpeedMps * KPH_PER_MPS) });
}

function positionText(lap: RaceLap): string {
  return `${lap.positionStart} → ${lap.positionEnd}`;
}

function OffTrack({ lap }: { lap: RaceLap }) {
  if (lap.offAll === 0 && lap.offPart === 0) {
    return (
      <span className="race-off">
        <span className="race-off-none">{t('races.laps.off-none')}</span>
      </span>
    );
  }
  return (
    <span className="race-off">
      <span className="race-off-all" role={lap.offAll > 0 ? 'img' : undefined} aria-label={lap.offAll > 0 ? t('races.laps.off-all', { count: lap.offAll }) : undefined}>
        {lap.offAll > 0 ? lap.offAll : ''}
      </span>
      <span className="race-off-part" role={lap.offPart > 0 ? 'img' : undefined} aria-label={lap.offPart > 0 ? t('races.laps.off-part', { count: lap.offPart }) : undefined}>
        {lap.offPart > 0 ? lap.offPart : ''}
      </span>
    </span>
  );
}

function LapRow({ race, lap, wide }: { race: RaceDetail; lap: RaceLap; wide: boolean }) {
  const best = lap.number === race.bestLap;
  const gap = gapText(lap, race.bestLapMs);
  const note = noteOf(lap);
  const link = (
    <Link to={paths.raceCompare(race.id, lap.number)} className="row-link">
      <span className="visually-hidden">{t('races.laps.compare-lap', { lap: lap.number })}</span>
    </Link>
  );
  const time = (
    <>
      <b className="race-lap-time">{formatTime(lap.timeMs)}</b>
      {best ? <span className="tag y best-tag">{t('races.laps.best')}</span> : null}
    </>
  );
  return (
    <tr className={best ? 'race-lap linked best' : 'race-lap linked'}>
      <td className="race-lap-number">{lap.number}</td>
      {wide ? (
        <>
          <td>
            {time}
            {note ? <span className="race-note-text">{note}</span> : null}
            {link}
          </td>
          <td className="race-gap">{gap}</td>
          <td>{positionText(lap)}</td>
          <td>{speedText(lap)}</td>
        </>
      ) : (
        <td>
          <span className="race-lap-line">
            {time}
            {gap ? <span className="race-gap">{gap}</span> : null}
          </span>
          <span className="race-lap-facts">{[positionText(lap), speedText(lap), note].filter(Boolean).join(' · ')}</span>
          {link}
        </td>
      )}
      <td>
        <OffTrack lap={lap} />
      </td>
      <td className="chevron-cell">
        <Icon name="chevron-right" size={18} />
      </td>
    </tr>
  );
}

function PitRow({ stop, wide, columns }: { stop: RacePitStop; wide: boolean; columns: number }) {
  const seconds = formatSeconds(stop.durationMs);
  const before = Math.round(stop.fuelBefore);
  const after = Math.round(stop.fuelAfter);
  return (
    <tr className="race-pit">
      <td colSpan={columns}>
        <span className="visually-hidden">{t('races.pit.hidden', { lap: stop.afterLap, seconds, before, after })}</span>
        <span className="race-pit-line" aria-hidden="true">
          <span className="race-pit-label">
            <Icon name="fuel" size={18} />
            {t('races.pit.label')}
          </span>
          <span>{wide ? t('races.pit.time', { seconds }) : seconds}</span>
          <span className="race-pit-fuel">{t('races.pit.fuel', { before, after })}</span>
          <span className="race-pit-rule" />
        </span>
      </td>
    </tr>
  );
}

function lapEnds(race: RaceDetail): number[] {
  let total = 0;
  return race.laps.map(lap => (total += lap.timeMs));
}

function pitBands(race: RaceDetail): RacePitBand[] {
  return race.pitStopList.map(stop => ({ fromMs: stop.fromMs, toMs: stop.toMs }));
}

function positionTicks(cars: number): number[] {
  return [1, ...Array.from({ length: Math.floor(cars / 10) }, (_, index) => (index + 1) * 10)].filter(tick => tick <= Math.max(cars, 1));
}

function fuelChanges(race: RaceDetail): boolean {
  const values = race.fuel.map(point => point.fuel);
  return values.length > 1 && Math.max(...values) - Math.min(...values) >= 1;
}

function PositionCharts({ race, ends, bands, showFuel }: { race: RaceDetail; ends: number[]; bands: RacePitBand[]; showFuel: boolean }) {
  const distances = useResource(() => api.raceDistances(race.id), [race.id]);
  const [cursorMs, setCursorMs] = useState(0);
  const [pointerOver, setPointerOver] = useState(false);
  const [focused, setFocused] = useState(false);
  const points = distances.data?.points ?? null;
  const facts = useMemo(() => cursorFacts(race, points, cursorMs), [race, points, cursorMs]);
  const snapMs = useMemo(() => positionChanges(race), [race]);
  const onActive = (source: 'pointer' | 'focus', active: boolean) => {
    if (source === 'pointer') setPointerOver(active);
    else {
      setFocused(active);
      if (!active) setPointerOver(false);
    }
  };
  const sentence = cursorSentence(facts);
  const cursor = (value: number | null, box: string[]): RaceTimeCursor => ({
    tMs: cursorMs,
    active: pointerOver || focused,
    value,
    box,
    valueText: sentence,
    snapMs,
    onCursor: setCursorMs,
    onActive
  });
  return (
    <section className="race-laps-charts" aria-labelledby="race-position-title">
      <h2 id="race-position-title">{t('races.position.title')}</h2>
      <p className="sub race-position-cursor" aria-live="polite">
        {sentence}
      </p>
      <RaceTimeChart
        label={t('races.position.label')}
        raceMs={race.raceMs}
        firstLap={race.firstLap}
        lapEnds={ends}
        pitStops={bands}
        points={race.position.map(point => ({ tMs: point.tMs, value: point.position }))}
        step
        min={Math.max(race.cars, 2)}
        max={1}
        ticks={positionTicks(race.cars)}
        bold={[race.startPosition, race.finishPosition]}
        tone="ink"
        height={POSITION_HEIGHT}
        cursor={cursor(facts.position, positionBox(facts))}
      />
      {showFuel ? (
        <>
          <h2 className="race-fuel-title">{t('races.fuel.title')}</h2>
          <RaceTimeChart
            label={t('races.fuel.label')}
            raceMs={race.raceMs}
            firstLap={race.firstLap}
            lapEnds={ends}
            pitStops={bands}
            points={race.fuel.map(point => ({ tMs: point.tMs, value: point.fuel }))}
            step={false}
            min={0}
            max={100}
            ticks={FUEL_TICKS}
            tone="ref"
            height={FUEL_HEIGHT}
            cursor={cursor(facts.fuel, fuelBox(facts))}
          />
        </>
      ) : null}
    </section>
  );
}

export function LapsTab({ race }: { race: RaceDetail }) {
  const wide = useWideLayout();
  const columns = wide ? 7 : 4;
  const ends = lapEnds(race);
  const bands = pitBands(race);
  const showFuel = fuelChanges(race);
  return (
    <div className="race-laps">
      <section className="race-laps-table" aria-labelledby="race-laps-title">
        <h2 id="race-laps-title">{t('races.laps.title')}</h2>
        <div className="table-wrap">
          <table aria-label={t('races.laps.title')}>
            <thead className={wide ? undefined : 'visually-hidden'}>
              <tr>
                <th>{t('races.laps.lap')}</th>
                <th>{t('races.laps.time')}</th>
                {wide ? (
                  <>
                    <th>{t('races.laps.gap')}</th>
                    <th>{t('races.laps.position')}</th>
                    <th>{t('races.laps.top-speed')}</th>
                  </>
                ) : null}
                <th>{t('races.laps.off-track')}</th>
                <th aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {race.laps.map(lap => {
                const stop = race.pitStopList.find(item => item.afterLap === lap.number);
                return (
                  <Fragment key={lap.number}>
                    <LapRow race={race} lap={lap} wide={wide} />
                    {stop && race.laps.some(next => next.number === lap.number + 1) ? <PitRow stop={stop} wide={wide} columns={columns} /> : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="sub race-laps-hint">
          {race.referenceLap === race.bestLap ? t('races.laps.hint-best') : t('races.laps.hint-reference', { lap: race.referenceLap })}
        </p>
        {race.offTrack > 0 ? (
          <p className="race-legend">
            <span>
              <i className="race-mark all" aria-hidden="true" />
              {t('races.legend.off-all')}
            </span>
            <span>
              <i className="race-mark part" aria-hidden="true" />
              {t('races.legend.off-part')}
            </span>
          </p>
        ) : null}
      </section>
      <PositionCharts key={race.id} race={race} ends={ends} bands={bands} showFuel={showFuel} />
      <SpeedSection race={race} wide={wide} />
    </div>
  );
}
