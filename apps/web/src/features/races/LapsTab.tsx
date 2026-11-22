import { Fragment, useMemo, useState } from 'react';
import { KPH_PER_MPS, type RaceDetail, type RaceLap, type RacePitStop } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { RaceTimeChart, type RacePitBand, type RaceTimeCursor } from '../../charts/RaceTimeChart.tsx';
import { cursorFacts, cursorSentence, fuelBox, positionBox, positionChanges } from './race-cursor.ts';
import { useResource } from '../../app/resource.ts';
import { formatSeconds, formatTime, signedSecondsText } from '../../app/format.ts';
import { SpeedSection } from './SpeedChart.tsx';
import { Icon } from '../../app/icons.tsx';
import { useWideLayout } from '../../app/layout.ts';
import { Link, paths } from '../../app/router.tsx';
import { t } from '../../app/i18n.ts';

const GAP_DIGITS = 3;
const POSITION_HEIGHT = 220;
const FUEL_HEIGHT = 140;
const FUEL_TICKS = [0, 50, 100];

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
      <span className="race-off-all">
        {lap.offAll > 0 ? lap.offAll : ''}
      </span>
      <span className="race-off-part">
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
    <Link to={paths.raceCompare(race.id, lap.number)} className="row-link" />
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
        <span className="race-pit-line">
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
    snapMs,
    onCursor: setCursorMs,
    onActive
  });
  return (
    <section className="race-laps-charts">
      <h2>{t('races.position.title')}</h2>
      <p className="sub race-position-cursor">
        {sentence}
      </p>
      <RaceTimeChart
        id="race-position"
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
            id="race-fuel"
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
      <section className="race-laps-table">
        <h2>{t('races.laps.title')}</h2>
        <div className="table-wrap">
          <table>
            {wide ? (
              <thead>
                <tr>
                  <th>{t('races.laps.lap')}</th>
                  <th>{t('races.laps.time')}</th>
                  <th>{t('races.laps.gap')}</th>
                  <th>{t('races.laps.position')}</th>
                  <th>{t('races.laps.top-speed')}</th>
                  <th>{t('races.laps.off-track')}</th>
                  <th />
                </tr>
              </thead>
            ) : null}
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
        {race.referenceLap === race.bestLap ? null : <p className="sub race-laps-hint">{t('races.laps.hint-reference', { lap: race.referenceLap })}</p>}
        {race.offTrack > 0 ? (
          <p className="race-legend">
            <span>
              <i className="race-mark all" />
              {t('races.legend.off-all')}
            </span>
            <span>
              <i className="race-mark part" />
              {t('races.legend.off-part')}
            </span>
          </p>
        ) : null}
      </section>
      <PositionCharts key={race.id} race={race} ends={ends} bands={bands} showFuel={showFuel} />
      <SpeedSection race={race} />
    </div>
  );
}
