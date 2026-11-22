import { useMemo, useState } from 'react';
import type { RaceDetail, RaceGoldenLap, RaceGoldenSector } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { formatTime, groupedNumber, signedSecondsText } from '../../app/format.ts';
import { useWideLayout } from '../../app/layout.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { SortHeader } from '../../app/SortHeader.tsx';
import { TrackMap, type TrackMark, type TrackSegment } from '../../charts/TrackMap.tsx';
import { isRawMissing, rawMissingText } from './race-errors.ts';
import { RaceBand, type BandValue } from './RaceBand.tsx';
import { lapsText } from './race-text.ts';
import { listText, t } from '../../app/i18n.ts';

const GOLDEN_MIN_LAPS = 3;
const JOIN_KPH = 5;
const JOIN_SIDE_M = 1.5;
const SPREAD_BAR_PX = 110;
const COLOURS: TrackSegment['colour'][] = ['a', 'b', 'c', 'd'];

type GoldenOk = Extract<RaceGoldenLap, { state: 'ok' }>;
type Order = 'spread' | 'turn';

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

function lapList(laps: number[]): string {
  return listText(laps.map(String), 'conjunction');
}

type Look = { colour: TrackSegment['colour']; dashed: boolean };

function lookOf(golden: GoldenOk, lap: number): Look {
  const index = Math.max(0, golden.sourceLaps.indexOf(lap));
  return { colour: COLOURS[index % COLOURS.length]!, dashed: Math.floor(index / COLOURS.length) % 2 === 1 };
}

function swatchClass(look: Look): string {
  return `lap-swatch lap-${look.colour}${look.dashed ? ' dashed' : ''}`;
}

function cleanText(laps: number[]): string {
  const contiguous = laps.length >= 3 && laps.every((lap, index) => index === 0 || lap === laps[index - 1]! + 1);
  if (contiguous) return t('races.golden.clean-range', { first: laps[0]!, last: laps.at(-1)! });
  return t('races.golden.clean-list', { count: laps.length, laps: lapList(laps) });
}

function turnBadge(turn: number | null): string {
  return turn === null ? '' : t('charts.turn.badge', { turn });
}

function sorted(sectors: RaceGoldenSector[], order: Order): RaceGoldenSector[] {
  const byTurn = (a: RaceGoldenSector, b: RaceGoldenSector) => (a.turn ?? Infinity) - (b.turn ?? Infinity);
  return [...sectors].sort(order === 'turn' ? byTurn : (a, b) => b.spreadMs - a.spreadMs || byTurn(a, b));
}

function leftLaps(race: RaceDetail, golden: GoldenOk, sector: RaceGoldenSector): number[] {
  const last = sector === golden.sectors.at(-1);
  const inside = (sM: number) => sM >= sector.fromM && (sM < sector.toM || last);
  const laps = race.offTrackList.filter(moment => moment.sM !== null && golden.cleanLaps.includes(moment.lap) && inside(moment.sM)).map(moment => moment.lap);
  return [...new Set(laps)].sort((a, b) => a - b);
}

function notesOf(race: RaceDetail, golden: GoldenOk, sector: RaceGoldenSector): string[] {
  const notes: string[] = [];
  if (!sector.bestJoins) notes.push(t('races.golden.no-join', { time: seconds(sector.bestMs), lap: sector.bestLap }));
  const left = sector.cleanLaps < golden.cleanLaps.length ? leftLaps(race, golden, sector) : [];
  if (left.length > 0) notes.push(t('races.golden.left', { count: left.length, laps: lapList(left) }));
  return notes;
}

function GoldenBand({ race, golden, wide }: { race: RaceDetail; golden: GoldenOk; wide: boolean }) {
  const values: BandValue[] = [
    { value: formatTime(golden.bestMs), caption: t('races.golden.best-lap', { lap: golden.bestLap }), tone: '' },
    {
      value: formatTime(golden.goldenMs),
      caption: wide ? t('races.golden.golden-from', { count: golden.sourceLaps.length, laps: lapList(golden.sourceLaps) }) : t('races.golden.golden'),
      tone: 'yellow'
    },
    { value: signedSecondsText(golden.goldenMs - golden.bestMs, 3), caption: t('races.golden.gain'), tone: '' }
  ];
  const facts = [lapsText(race), t('common.count.car', { count: race.cars }), cleanText(golden.cleanLaps)].join(' · ');
  return <RaceBand label={t('races.golden.band')} title={wide ? (race.carName ?? t('races.band.race')) : null} facts={facts} values={values} className="race-golden-band" />;
}

function GoldenTable({ race, golden, wide }: { race: RaceDetail; golden: GoldenOk; wide: boolean }) {
  const [order, setOrder] = useState<Order>('spread');
  const rows = useMemo(() => sorted(golden.sectors, order), [golden.sectors, order]);
  const widest = Math.max(...golden.sectors.map(sector => sector.spreadMs), 1);
  return (
    <div className="race-golden-turns">
      <h2 id="race-golden-turns">{t('races.golden.turns')}</h2>
      <div role="table" aria-labelledby="race-golden-turns" className={`golden-table${wide ? ' golden-table-wide' : ''}`}>
        <div role="row" className="golden-head">
          <SortHeader label={t('races.golden.column-turn')} active={order === 'turn'} direction="ascending" onSort={() => setOrder('turn')} />
          {wide ? <span role="columnheader">{t('races.golden.column-part')}</span> : null}
          <span role="columnheader">{t('races.golden.column-golden')}</span>
          {wide ? <span role="columnheader">{t('races.golden.column-best')}</span> : null}
          {wide ? <span role="columnheader">{t('races.golden.column-median')}</span> : null}
          <SortHeader label={t(wide ? 'races.golden.column-spread' : 'races.golden.column-spread-short')} active={order === 'spread'} direction="descending" onSort={() => setOrder('spread')} />
        </div>
        {rows.map(sector => (
          <div role="row" className="golden-row" key={sector.fromM}>
            <span role="cell">
              <span className="tag y">{turnBadge(sector.turn)}</span>
            </span>
            {wide ? (
              <span role="cell" className="golden-part">
                {t('races.golden.part', { from: groupedNumber(sector.fromM), to: groupedNumber(sector.toM) })}
              </span>
            ) : null}
            <span role="cell" className="golden-source">
              <span className="golden-chip">
                <b className="golden-time">{seconds(sector.ms)}</b>
                <i className={swatchClass(lookOf(golden, sector.lap))} aria-hidden="true" />
                {t('races.golden.lap', { lap: sector.lap })}
              </span>
              {notesOf(race, golden, sector).map(note => (
                <span key={note} className="golden-note">
                  {note}
                </span>
              ))}
            </span>
            {wide ? (
              <span role="cell">
                {seconds(sector.bestMs)} <span className="sub">{t('races.golden.lap', { lap: sector.bestLap })}</span>
              </span>
            ) : null}
            {wide ? <span role="cell">{seconds(sector.medianMs)}</span> : null}
            <span role="cell" className="golden-spread">
              {wide ? <i style={{ width: `${Math.max(2, Math.round((sector.spreadMs / widest) * SPREAD_BAR_PX))}px` }} aria-hidden="true" /> : null}
              {t('app.unit.seconds', { value: seconds(sector.spreadMs) })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GoldenMap({ race, golden }: { race: RaceDetail; golden: GoldenOk }) {
  const speed = useResource(() => api.raceSpeed(race.id), [race.id]);
  const segments = useMemo<TrackSegment[]>(() => golden.sectors.map(sector => ({ fromM: sector.fromM, toM: sector.toM, ...lookOf(golden, sector.lap) })), [golden]);
  const marks = useMemo<TrackMark[]>(
    () => [
      ...golden.sectors.slice(1).map((sector): TrackMark => ({ sM: sector.fromM, title: t('races.golden.legend-join'), variant: 'join' })),
      ...(speed.data?.turns ?? []).map((turn): TrackMark => ({ sM: (turn.fromSM + turn.toSM) / 2, title: t('charts.turn.title', { turn: turn.turn }), label: t('charts.turn.badge', { turn: turn.turn }), variant: 'badge', beside: true }))
    ],
    [golden.sectors, speed.data]
  );
  return (
    <section className="panel race-golden-map" aria-labelledby="race-golden-map">
      <h2 id="race-golden-map">{t('races.golden.map-title')}</h2>
      <TrackMap label={t('races.golden.map-label')} reference={golden.line} segments={segments} marks={marks} plain lapLine />
      <div className="legend map-legend">
        {golden.sourceLaps.map(lap => (
          <span key={lap}>
            <i className={swatchClass(lookOf(golden, lap))} />
            {t('races.golden.legend-lap', { lap })}
          </span>
        ))}
        <span>
          <i className="join" />
          {t('races.golden.legend-join')}
        </span>
      </div>
    </section>
  );
}

function GoldenBody({ race, golden }: { race: RaceDetail; golden: GoldenOk }) {
  const wide = useWideLayout();
  const method = wide
    ? t('races.golden.method', { speed: JOIN_KPH, side: JOIN_SIDE_M })
    : t('races.golden.method-short', { count: golden.sourceLaps.length, laps: lapList(golden.sourceLaps), speed: JOIN_KPH, side: JOIN_SIDE_M });
  return (
    <>
      <GoldenBand race={race} golden={golden} wide={wide} />
      <p className="sub race-golden-method">{method}</p>
      <div className={wide ? 'race-golden-body race-golden-wide' : 'race-golden-body'}>
        <GoldenTable race={race} golden={golden} wide={wide} />
        <GoldenMap race={race} golden={golden} />
      </div>
    </>
  );
}

function excludedTexts(golden: Extract<RaceGoldenLap, { state: 'too-few' }>): string[] {
  const of = (reason: 'first' | 'pit' | 'open') => golden.excluded.filter(item => item.reason === reason).map(item => item.lap);
  const listed = (key: 'races.golden.not-pit' | 'races.golden.not-open', laps: number[]) => (laps.length > 0 ? [t(key, { count: laps.length, laps: lapList(laps) })] : []);
  return [
    ...of('first').map(lap => t(lap === 1 ? 'races.golden.not-first' : 'races.golden.not-first-recorded', { lap })),
    ...listed('races.golden.not-pit', of('pit')),
    ...listed('races.golden.not-open', of('open'))
  ];
}

function reasonTexts(golden: Exclude<RaceGoldenLap, { state: 'ok' }>): string[] {
  if (golden.state === 'gap') return [golden.turn === null ? t('races.golden.gap-lap') : t('races.golden.gap', { turn: golden.turn })];
  if (golden.state === 'no-chain') return [t('races.golden.no-chain')];
  const count = golden.cleanLaps.length;
  const few = count === 0 ? t('races.golden.few-none', { min: GOLDEN_MIN_LAPS }) : t('races.golden.few', { min: GOLDEN_MIN_LAPS, count, laps: lapList(golden.cleanLaps) });
  return [few, ...excludedTexts(golden)];
}

function NoGolden({ golden }: { golden: Exclude<RaceGoldenLap, { state: 'ok' }> }) {
  return (
    <section className="panel race-golden-none">
      <h2>{t('races.golden.none')}</h2>
      {reasonTexts(golden).map(text => (
        <p key={text}>{text}</p>
      ))}
    </section>
  );
}

export function GoldenTab({ race }: { race: RaceDetail }) {
  const golden = useResource(() => api.raceGolden(race.id), [race.id]);
  const data = golden.data;
  return (
    <section className="race-golden-tab">
      {isRawMissing(golden.error) ? (
        <p className="sub">{rawMissingText()}</p>
      ) : golden.error ? (
        <p className="error">{errorText(golden.error)}</p>
      ) : data === null ? (
        <p className="sub">{t('races.golden.reading')}</p>
      ) : data.state === 'ok' ? (
        <GoldenBody race={race} golden={data} />
      ) : (
        <NoGolden golden={data} />
      )}
    </section>
  );
}
