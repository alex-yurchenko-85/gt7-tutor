import { useCallback, useMemo, useState } from 'react';
import { KPH_PER_MPS, type MessageKey, type Params, type RaceDetail, type RaceOffTrack, type RaceOffTrackView, type RaceRecurringPlace } from '@gt7/contracts';
import { api, ApiError } from '../../api/client.ts';
import { ChannelChart, type ChartBand, type ChartTick } from '../../charts/ChannelChart.tsx';
import { groupedMetres } from '../../app/format.ts';
import { MapDialog, type MapDialogItem } from '../../charts/MapDialog.tsx';
import { MapPanel } from '../../charts/MapPanel.tsx';
import { OffTrackStrip, momentLabel, placeParts, speedsText, tenMetres, wheelsText } from '../../charts/OffTrackStrip.tsx';
import { labelledTicks } from '../../charts/ticks.ts';
import { TrackMap, type TrackLine, type TrackMark } from '../../charts/TrackMap.tsx';
import { useFrameCursor } from '../../charts/use-frame-cursor.ts';
import { useWideLayout } from '../../app/layout.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { raceName } from './RacesView.tsx';
import { isRawMissing, rawMissingText } from './race-errors.ts';
import { t } from '../../app/i18n.ts';

const HEIGHT_CHART = 110;
const SPEED_CHART = 150;
const BOX_SIDE_SHARE = 0.6;
const OTHER_PLACE_M = 80;
const VALUE_TICK_COUNT = 3;

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function byLapAndDistance(moments: RaceOffTrack[]): RaceOffTrack[] {
  return [...moments].sort((a, b) => a.lap - b.lap || (a.sM ?? 0) - (b.sM ?? 0));
}

function insidePlace(sM: number, place: RaceRecurringPlace): boolean {
  return place.fromSM <= place.toSM ? sM >= place.fromSM && sM <= place.toSM : sM >= place.fromSM || sM <= place.toSM;
}

function otherPlaces(moments: RaceOffTrack[], places: RaceRecurringPlace[], lengthM: number): number {
  const others = moments
    .map(moment => moment.sM)
    .filter((sM): sM is number => sM !== null && !places.some(place => insidePlace(sM, place)))
    .sort((a, b) => a - b);
  const count = others.reduce((total, sM, index) => (index === 0 || sM - others[index - 1]! > OTHER_PLACE_M ? total + 1 : total), 0);
  const first = others[0];
  const last = others.at(-1);
  return count > 1 && first !== undefined && last !== undefined && first + lengthM - last <= OTHER_PLACE_M ? count - 1 : count;
}

type ReferenceKeys = { best: MessageKey; lap: MessageKey };

function referenceText(race: RaceDetail, keys: ReferenceKeys, params: Params = {}): string {
  return race.referenceLap === race.bestLap ? t(keys.best, params) : t(keys.lap, { ...params, lap: race.referenceLap });
}

function momentText(moment: RaceOffTrack): string {
  return t('races.off.item', { lap: moment.lap, wheels: wheelsText(moment), speeds: speedsText(moment) });
}

function at(values: number[], gridM: number, sM: number): number | null {
  const value = values[Math.min(values.length - 1, Math.max(0, Math.round(sM / gridM)))];
  return value === undefined ? null : value;
}

function ticksOf(min: number, max: number): ChartTick[] {
  return labelledTicks(min, max, VALUE_TICK_COUNT);
}

function placeBands(places: RaceRecurringPlace[], lengthM: number): ChartBand[] {
  return places.flatMap(place => placeParts(place, lengthM).map((part, index) => ({ ...part, label: index === 0 ? place.label : `${place.label} ` })));
}

function RecurringPlaces({ race, view, moments }: { race: RaceDetail; view: RaceOffTrackView | null; moments: RaceOffTrack[] }) {
  const places = view?.recurring ?? race.recurring;
  const others = otherPlaces(moments, places, view?.lengthM ?? race.lapLengthM ?? Infinity);
  return (
    <section className="panel race-places" aria-labelledby="race-places-title">
      <h2 id="race-places-title">{t('races.off.places-title')}</h2>
      <p className="sub">{t('races.off.places-text')}</p>
      {places.length === 0 ? <p className="race-places-none">{t('races.off.places-none')}</p> : null}
      <ul>
        {places.map(place => {
          const speed = view ? at(view.speedMps, view.gridM, place.sM) : null;
          const loss = Math.round(place.largestLossMps * KPH_PER_MPS);
          return (
            <li key={place.label}>
              <b className="race-place-letter">{place.label}</b>
              <span className="race-place-text">
                <b>{tenMetres(place.sM)}.</b>{' '}
                {place.allWheels > 0 ? t('races.off.place-all', { count: place.allWheels }) : t('races.off.place-part')}
                <span className="race-place-detail">
                  {speed === null ? t('races.off.place-detail', { loss }) : referenceText(race, { best: 'races.off.place-detail-best', lap: 'races.off.place-detail-lap' }, { speed: Math.round(speed * KPH_PER_MPS), loss })}
                </span>
              </span>
              <span className="race-place-count">
                {t('races.off.place-count', { laps: place.laps.length, total: race.laps.length })}
              </span>
            </li>
          );
        })}
      </ul>
      {others > 0 ? <p className="race-places-other">{t('races.off.other-places', { count: others })}</p> : null}
    </section>
  );
}

function MomentList({ moments }: { moments: RaceOffTrack[] }) {
  const laps = [...new Set(moments.map(moment => moment.lap))];
  return (
    <ul className="race-moment-list" aria-label={t('races.off.moments-label')}>
      {laps.map(lap => (
        <li key={lap}>
          <h3>{t('races.off.lap', { lap })}</h3>
          <ul>
            {moments
              .filter(moment => moment.lap === lap)
              .map((moment, index) => (
                <li key={index}>{moment.sM === null ? capital(t('races.off.moment', { wheels: wheelsText(moment), speeds: speedsText(moment) })) : t('races.off.moment-at', { place: tenMetres(moment.sM), wheels: wheelsText(moment), speeds: speedsText(moment) })}</li>
              ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function StripBox({ moment, lengthM, row, rows }: { moment: RaceOffTrack; lengthM: number; row: number; rows: number }) {
  const share = (moment.sM ?? 0) / lengthM;
  const up = row > rows / 2;
  return (
    <div
      className={`strip-box ${share > BOX_SIDE_SHARE ? 'left' : 'right'}${up ? ' up' : ''}`}
      style={{ left: `${(share * 100).toFixed(2)}%`, top: `calc(26px + ${up ? row - 1 : row} * 34px)` }}
      aria-hidden="true"
    >
      <b>{t('races.off.box-title', { lap: moment.lap, place: tenMetres(moment.sM ?? 0) })}</b>
      <span>{capital(wheelsText(moment))}</span>
      <span>{speedsText(moment)}</span>
    </div>
  );
}

function OffTrackBody({ race, view, moments }: { race: RaceDetail; view: RaceOffTrackView; moments: RaceOffTrack[] }) {
  const wide = useWideLayout();
  const lapLine = race.laps.some(lap => lap.number === race.referenceLap && lap.closed);
  const [cursorSM, setCursorNow, scrub] = useFrameCursor();
  const [selected, setSelected] = useState<number | null>(null);
  const [viewing, setViewing] = useState(false);
  const select = useCallback(
    (index: number | null) => {
      setSelected(index);
      const moment = index === null ? null : moments[index];
      if (moment && moment.sM !== null) setCursorNow(moment.sM);
    },
    [moments, setCursorNow]
  );
  const line = useMemo<TrackLine>(() => ({ gridM: view.gridM, x: view.x, z: view.z }), [view]);
  const marks = useMemo<TrackMark[]>(
    () => [
      ...moments.flatMap((moment, index): TrackMark[] =>
        moment.sM === null
          ? []
          : [{ sM: moment.sM, title: momentLabel(moment), variant: moment.wheels === 4 ? 'off-all' : 'off-part', selected: selected === index, onSelect: () => select(index) }]
      ),
      ...view.recurring.map((place): TrackMark => ({ sM: place.sM, title: t('races.off.place-mark', { label: place.label }), label: place.label, variant: 'place', beside: true }))
    ],
    [moments, view.recurring, selected, select]
  );
  const items = useMemo<MapDialogItem[]>(
    () =>
      moments.flatMap(moment =>
        moment.sM === null ? [] : [{ key: `${moment.lap}-${moment.sM}`, number: String(moment.lap), label: momentText(moment), detail: tenMetres(moment.sM), sM: moment.sM }]
      ),
    [moments]
  );
  const { minHeight, heightSeries, heightTicks, heightMax, speeds, speedSeries, speedMax, speedTicks, bands } = useMemo(() => {
    const lowest = view.heightM.reduce((min, value) => Math.min(min, value), Infinity);
    const highest = view.heightM.reduce((max, value) => Math.max(max, value), -Infinity);
    const kph = view.speedMps.map(value => value * KPH_PER_MPS);
    const top = kph.reduce((max, value) => Math.max(max, value), -Infinity) * 1.05;
    const span = Math.max(1, highest - lowest);
    return {
      minHeight: lowest,
      heightSeries: [{ name: 'ink' as const, values: view.heightM.map(value => value - lowest) }],
      heightTicks: ticksOf(0, span),
      heightMax: span * 1.05,
      speeds: kph,
      speedSeries: [{ name: 'ref' as const, values: kph }],
      speedMax: top,
      speedTicks: ticksOf(0, top),
      bands: placeBands(view.recurring, view.lengthM)
    };
  }, [view]);
  const speedField = useMemo(() => ({ title: referenceText(race, { best: 'races.off.speed-best', lap: 'races.off.speed-lap' }), unit: t('races.off.kph') }), [race]);
  const heightField = useMemo(() => ({ title: t('races.off.height'), unit: t('races.off.metres') }), []);
  const heightAt = at(view.heightM, view.gridM, cursorSM);
  const speedAt = at(speeds, view.gridM, cursorSM);
  const chosen = selected === null ? null : (moments[selected] ?? null);
  const facts = chosen ? momentText(chosen) : '';
  const laps = race.laps.map(lap => lap.number);
  const map = (
    <MapPanel
      title={t('races.off.places')}
      legend={[]}
      extraLegend={[
        { mark: 'off-all', text: t('races.off.legend-all') },
        { mark: 'off-part', text: t('races.off.legend-part') },
        { mark: 'place', text: t('races.off.legend-place') }
      ]}
      onView={() => setViewing(true)}
    >
      <div className="review-map">
        <TrackMap label={referenceText(race, { best: 'races.off.map-best', lap: 'races.off.map-lap' }, { count: moments.length })} reference={line} marks={marks} cursorSM={cursorSM} plain lapLine={lapLine} />
      </div>
      <MapDialog
        open={viewing}
        onClose={() => setViewing(false)}
        title={raceName(race)}
        lengthM={view.lengthM}
        reference={line}
        corners={[]}
        items={items}
        listTitle={t('races.off.list-title')}
        mapLabel={referenceText(race, { best: 'races.off.dialog-best', lap: 'races.off.dialog-lap' }, { race: raceName(race) })}
        lineName={referenceText(race, { best: 'races.off.line-best', lap: 'races.off.line-lap' })}
        lapLine={lapLine}
        metresText={groupedMetres}
      />
    </MapPanel>
  );
  const charts = (
    <div className="charts race-off-charts">
      <div className="channel in-field">
        <div className="chart-field" role="group" aria-labelledby="race-strip-label">
          <div className="channel-label">
            <span id="race-strip-label" className="visually-hidden">
              {t('races.off.strip-label')}
            </span>
            <b className="field-title" aria-hidden="true">
              {t('races.off.strip-title')}
            </b>
            <span>{wide ? facts : ''}</span>
          </div>
          <span className="field-unit" aria-hidden="true">
            {t('races.off.strip-unit')}
          </span>
          <OffTrackStrip
            lengthM={view.lengthM}
            laps={laps}
            moments={moments}
            recurring={view.recurring}
            pitLane={view.pitLane}
            cursorSM={cursorSM}
            onCursor={scrub}
            selected={selected}
            onSelect={select}
            describedBy="race-off-hint"
            box={wide && chosen && chosen.sM !== null ? <StripBox moment={chosen} lengthM={view.lengthM} row={Math.max(0, laps.indexOf(chosen.lap)) + 1} rows={laps.length} /> : null}
          />
        </div>
      </div>
      <ChannelChart
        id="race-height"
        describedBy="race-off-hint"
        label={t('races.off.height-label')}
        series={heightSeries}
        min={0}
        max={heightMax}
        gridM={view.gridM}
        lengthM={view.lengthM}
        cursorSM={cursorSM}
        onCursor={setCursorNow}
        onScrub={scrub}
        readout={heightAt === null ? t('races.speed.no-data') : t('races.off.height-readout', { metres: Math.round(heightAt - minHeight) })}
        ticks={heightTicks}
        height={HEIGHT_CHART}
        bands={bands}
        field={heightField}
      />
      <ChannelChart
        id="race-best-speed"
        describedBy="race-off-hint"
        label={referenceText(race, { best: 'races.off.speed-label-best', lap: 'races.off.speed-label-lap' })}
        series={speedSeries}
        min={0}
        max={speedMax}
        gridM={view.gridM}
        lengthM={view.lengthM}
        cursorSM={cursorSM}
        onCursor={setCursorNow}
        onScrub={scrub}
        readout={speedAt === null ? t('races.speed.no-data') : t('races.off.speed-readout', { lap: race.referenceLap, speed: Math.round(speedAt) })}
        ticks={speedTicks}
        height={SPEED_CHART}
        bands={bands}
        field={speedField}
      />
      <p className="race-legend">
        <span>
          <i className="race-mark pit-lane" aria-hidden="true" />
          {t('races.off.chart-pit')}
        </span>
        <span>
          <i className="race-mark turn" aria-hidden="true" />
          {t('races.off.chart-place')}
        </span>
      </p>
      <p className="cursor-line" aria-live="polite">
        {t(!wide && facts ? 'races.off.cursor-facts' : 'races.off.cursor', { place: tenMetres(cursorSM), length: tenMetres(view.lengthM), facts })}
      </p>
      <p id="race-off-hint" hidden>
        {t('races.off.hint')}
      </p>
    </div>
  );
  const places = <RecurringPlaces race={race} view={view} moments={moments} />;
  if (!wide) {
    return (
      <div className="review-phone race-off-body">
        {map}
        {places}
        {charts}
      </div>
    );
  }
  return (
    <div className="wide race-off-body">
      <div>
        {map}
        {charts}
      </div>
      <div>{places}</div>
    </div>
  );
}

export function OffTrackTab({ race }: { race: RaceDetail }) {
  const empty = race.offTrack === 0;
  const view = useResource(() => (empty ? Promise.resolve(null) : api.raceOffTrack(race.id)), [race.id, empty]);
  const moments = useMemo(() => byLapAndDistance(view.data?.moments ?? race.offTrackList), [view.data, race.offTrackList]);
  if (empty) {
    return (
      <section className="race-off-tab">
        <h2 className="race-off-title">{t('races.off.none')}</h2>
      </section>
    );
  }
  const missing = isRawMissing(view.error);
  const noLine = (view.error instanceof ApiError && view.error.code === 'no-match') || (view.data !== null && view.data.moments.every(moment => moment.sM === null));
  return (
    <section className="race-off-tab">
      {missing || noLine ? (
        <>
          <p className="sub race-off-note">{missing ? rawMissingText() : t('races.off.no-line')}</p>
          <MomentList moments={moments} />
        </>
      ) : view.error ? (
        <p className="error">{errorText(view.error)}</p>
      ) : view.data ? (
        <OffTrackBody race={race} view={view.data} moments={moments} />
      ) : (
        <p className="sub">{t('races.off.reading')}</p>
      )}
    </section>
  );
}
