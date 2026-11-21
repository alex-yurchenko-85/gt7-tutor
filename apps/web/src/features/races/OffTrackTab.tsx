import { useCallback, useMemo, useState } from 'react';
import { KPH_PER_MPS, type RaceDetail, type RaceOffTrack, type RaceOffTrackView, type RaceRecurringPlace } from '@gt7/contracts';
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
import { counted } from '../../app/plural.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { raceName } from './RacesView.tsx';
import { RAW_MISSING_TEXT, isRawMissing } from './race-errors.ts';

const NO_LINE_TEXT = 'The laps of this race give no line of the track, so the places cannot be drawn.';
const STRIP_LABEL = 'Off the track, lap by lap, over the distance from the lap line';
const HEIGHT_FIELD = { title: 'Height of the track', unit: 'm' };
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

function referenceName(race: RaceDetail): string {
  return race.referenceLap === race.bestLap ? 'the best lap' : `lap ${race.referenceLap}`;
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
  const lapName = referenceName(race);
  return (
    <section className="panel race-places" aria-labelledby="race-places-title">
      <h2 id="race-places-title">Recurring places</h2>
      <p className="sub">The same place in 3 or more laps.</p>
      {places.length === 0 ? <p className="race-places-none">No place in 3 or more laps.</p> : null}
      <ul>
        {places.map(place => {
          const speed = view ? at(view.speedMps, view.gridM, place.sM) : null;
          return (
            <li key={place.label}>
              <b className="race-place-letter">{place.label}</b>
              <span className="race-place-text">
                <b>{tenMetres(place.sM)}.</b>{' '}
                {place.allWheels > 0 ? `All four wheels off in ${counted(place.allWheels, 'lap')}.` : 'Two or three wheels off.'}
                <span className="race-place-detail">
                  {speed === null ? '' : `${capital(lapName.replace(/^the /, ''))}: ${Math.round(speed * KPH_PER_MPS)} km/h here. `}Largest speed loss: {Math.round(place.largestLossMps * KPH_PER_MPS)} km/h.
                </span>
              </span>
              <span className="race-place-count">
                {place.laps.length} of {race.laps.length}
              </span>
            </li>
          );
        })}
      </ul>
      {others > 0 ? <p className="race-places-other">{`${counted(others, 'other place')}, each in 1 or 2 laps.`}</p> : null}
    </section>
  );
}

function MomentList({ moments }: { moments: RaceOffTrack[] }) {
  const laps = [...new Set(moments.map(moment => moment.lap))];
  return (
    <ul className="race-moment-list" aria-label="Moments by lap">
      {laps.map(lap => (
        <li key={lap}>
          <h3>Lap {lap}</h3>
          <ul>
            {moments
              .filter(moment => moment.lap === lap)
              .map((moment, index) => (
                <li key={index}>{moment.sM === null ? `${capital(wheelsText(moment))}, ${speedsText(moment)}` : `${tenMetres(moment.sM)}: ${wheelsText(moment)}, ${speedsText(moment)}`}</li>
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
      <b>{`Lap ${moment.lap} · ${tenMetres(moment.sM ?? 0)}`}</b>
      <span>{`${capital(wheelsText(moment))}`}</span>
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
      ...view.recurring.map((place): TrackMark => ({ sM: place.sM, title: `Recurring place ${place.label}`, label: place.label, variant: 'place', beside: true }))
    ],
    [moments, view.recurring, selected, select]
  );
  const items = useMemo<MapDialogItem[]>(
    () =>
      moments.flatMap(moment =>
        moment.sM === null ? [] : [{ key: `${moment.lap}-${moment.sM}`, number: String(moment.lap), label: `Lap ${moment.lap}: ${wheelsText(moment)}, ${speedsText(moment)}`, detail: tenMetres(moment.sM), sM: moment.sM }]
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
  const speedField = useMemo(() => ({ title: `Speed of ${referenceName(race)}`, unit: 'km/h' }), [race]);
  const heightAt = at(view.heightM, view.gridM, cursorSM);
  const speedAt = at(speeds, view.gridM, cursorSM);
  const chosen = selected === null ? null : (moments[selected] ?? null);
  const facts = chosen ? `Lap ${chosen.lap}: ${wheelsText(chosen)}, ${speedsText(chosen)}` : '';
  const laps = race.laps.map(lap => lap.number);
  const map = (
    <MapPanel
      title="Places"
      legend={[]}
      extraLegend={[
        { mark: 'off-all', text: 'all four wheels off the track' },
        { mark: 'off-part', text: 'two or three wheels off' },
        { mark: 'place', text: 'recurring place' }
      ]}
      onView={() => setViewing(true)}
    >
      <div className="review-map">
        <TrackMap label={`Map of the line of ${referenceName(race)} with ${counted(moments.length, 'moment')} off the track`} reference={line} marks={marks} cursorSM={cursorSM} plain lapLine={lapLine} />
      </div>
      <MapDialog
        open={viewing}
        onClose={() => setViewing(false)}
        title={raceName(race)}
        lengthM={view.lengthM}
        reference={line}
        corners={[]}
        items={items}
        listTitle="Moments off the track"
        listHint="Select a moment to find it on the line."
        mapLabel={`Line of ${referenceName(race)} of ${raceName(race)} with the moments off the track`}
        lineName={`Line of ${referenceName(race)}`}
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
              {STRIP_LABEL}
            </span>
            <b className="field-title" aria-hidden="true">
              Off the track
            </b>
            <span>{wide ? facts : ''}</span>
          </div>
          <span className="field-unit" aria-hidden="true">
            lap
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
            box={wide && chosen && chosen.sM !== null ? <StripBox moment={chosen} lengthM={view.lengthM} row={Math.max(0, laps.indexOf(chosen.lap)) + 1} rows={laps.length} /> : null}
          />
        </div>
      </div>
      <ChannelChart
        id="race-height"
        label="Height of the track, m"
        series={heightSeries}
        min={0}
        max={heightMax}
        gridM={view.gridM}
        lengthM={view.lengthM}
        cursorSM={cursorSM}
        onCursor={setCursorNow}
        onScrub={scrub}
        readout={heightAt === null ? 'no data' : `${Math.round(heightAt - minHeight)} m above the lowest place`}
        ticks={heightTicks}
        height={HEIGHT_CHART}
        bands={bands}
        field={HEIGHT_FIELD}
      />
      <ChannelChart
        id="race-best-speed"
        label={`Speed of ${referenceName(race)}, km/h`}
        series={speedSeries}
        min={0}
        max={speedMax}
        gridM={view.gridM}
        lengthM={view.lengthM}
        cursorSM={cursorSM}
        onCursor={setCursorNow}
        onScrub={scrub}
        readout={speedAt === null ? 'no data' : `lap ${race.referenceLap}: ${Math.round(speedAt)}`}
        ticks={speedTicks}
        height={SPEED_CHART}
        bands={bands}
        field={speedField}
      />
      <p className="race-legend">
        <span>
          <i className="race-mark all" aria-hidden="true" />
          all four wheels
        </span>
        <span>
          <i className="race-mark part" aria-hidden="true" />
          two or three wheels
        </span>
        <span>
          <i className="race-mark pit-lane" aria-hidden="true" />
          pit lane
        </span>
        <span>
          <i className="race-mark turn" aria-hidden="true" />
          recurring place
        </span>
      </p>
      <p className="cursor-line" aria-live="polite">
        {`Cursor at ${tenMetres(cursorSM)} of ${tenMetres(view.lengthM)}.${!wide && facts ? ` ${facts}.` : ''}`}
      </p>
      <p className="sub">Move the pointer or a finger across a chart, or focus a chart and use the arrow keys. In the lap rows the arrow keys move from moment to moment. The map point shows the same place.</p>
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

function OffTrackHeading({ moments }: { moments: RaceOffTrack[] }) {
  const all = moments.filter(moment => moment.wheels === 4).length;
  return (
    <h2 className="race-off-title">
      {counted(moments.length, 'moment')} off the track <span className="sub">{`${all} with all four wheels`}</span>
    </h2>
  );
}

export function OffTrackTab({ race }: { race: RaceDetail }) {
  const empty = race.offTrack === 0;
  const view = useResource(() => (empty ? Promise.resolve(null) : api.raceOffTrack(race.id)), [race.id, empty]);
  const moments = useMemo(() => byLapAndDistance(view.data?.moments ?? race.offTrackList), [view.data, race.offTrackList]);
  if (empty) {
    return (
      <section className="race-off-tab">
        <h2 className="race-off-title">No moments off the track in this race.</h2>
      </section>
    );
  }
  const missing = isRawMissing(view.error);
  const noLine = (view.error instanceof ApiError && view.error.code === 'no-match') || (view.data !== null && view.data.moments.every(moment => moment.sM === null));
  return (
    <section className="race-off-tab">
      <OffTrackHeading moments={moments} />
      {missing || noLine ? (
        <>
          <p className="sub race-off-note">{missing ? RAW_MISSING_TEXT : NO_LINE_TEXT}</p>
          <MomentList moments={moments} />
        </>
      ) : view.error ? (
        <p className="error">{errorText(view.error)}</p>
      ) : view.data ? (
        <OffTrackBody race={race} view={view.data} moments={moments} />
      ) : (
        <p className="sub">Reading the places off the track…</p>
      )}
    </section>
  );
}
