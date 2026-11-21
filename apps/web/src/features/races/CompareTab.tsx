import { useCallback, useMemo, useState } from 'react';
import type { Difference, RaceDetail, RaceLap } from '@gt7/contracts';
import { api, ApiError } from '../../api/client.ts';
import { SIDE_FACTOR } from '../../charts/geometry.ts';
import { useFrameCursor } from '../../charts/use-frame-cursor.ts';
import { formatTime, groupedMetres } from '../../app/format.ts';
import { useWideLayout } from '../../app/layout.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { paths, useRouter } from '../../app/router.tsx';
import { CompareCharts, CompareMap, Differences, type DifferencesWords, type LineComparison, type LineWords } from '../review/line-compare.tsx';
import { differenceText, sizeText } from '../cues/cue-format.ts';
import { raceName } from './RacesView.tsx';
import { RAW_MISSING_TEXT, isRawMissing } from './race-errors.ts';

const GAP_DIGITS = 3;
const NO_MATCH_TEXT = 'These two laps do not match. Choose another lap.';
const ONE_LAP_TEXT = 'This race has one lap. There is no other lap to compare.';

function lapNumber(race: RaceDetail, value: string | null): number | null {
  if (value === null) return null;
  const number = Number(value);
  return race.laps.some(lap => lap.number === number) ? number : null;
}

function defaultLap(race: RaceDetail): number | null {
  const candidates = race.laps.filter(lap => lap.number !== race.referenceLap);
  return candidates.at(-1)?.number ?? null;
}

function defaultWith(race: RaceDetail, lap: number): number | null {
  if (lap !== race.referenceLap && race.laps.some(item => item.number === race.referenceLap)) return race.referenceLap;
  const others = race.laps.filter(item => item.number !== lap);
  return others.reduce<RaceLap | null>((best, item) => (best === null || item.timeMs < best.timeMs ? item : best), null)?.number ?? null;
}

function optionText(lap: RaceLap): string {
  return `Lap ${lap.number} · ${formatTime(lap.timeMs)}`;
}

function describeAgainst(withLap: number): (difference: Difference) => string {
  return difference => (difference.kind === 'off-line' ? `Up to ${sizeText(difference.size, difference.unit)} from the line of lap ${withLap}` : differenceText(difference));
}

function timeNote(race: RaceDetail, lap: number, withLap: number): string | null {
  const compared = race.laps.find(item => item.number === lap);
  const other = race.laps.find(item => item.number === withLap);
  const outLap = compared?.pitOut || other?.pitOut;
  if ((compared?.pitIn || other?.pitIn) && outLap) return 'The curve starts at the pit exit. The rest of the gap is in the pit lane.';
  if (compared?.pitIn || other?.pitIn) return 'The rest of the gap is in the pit lane.';
  if (compared?.pitOut && other?.pitOut) return `This lap and lap ${withLap} start in the pit lane. The curve starts at the pit exit.`;
  if (compared?.pitOut) return 'This lap starts in the pit lane. The curve starts at the pit exit.';
  if (other?.pitOut) return `Lap ${withLap} starts in the pit lane. The curve starts at the pit exit.`;
  return null;
}

function lapWords(race: RaceDetail, lap: number, withLap: number): LineWords {
  const note = timeNote(race, lap, withLap);
  const pit = race.laps.some(item => (item.number === lap || item.number === withLap) && (item.pitIn || item.pitOut));
  const metres = groupedMetres;
  return {
    referenceName: `lap ${withLap}`,
    youName: `lap ${lap}`,
    referenceLegend: `lap ${withLap}${withLap === race.bestLap ? ', best' : ''}`,
    youLegend: `lap ${lap}`,
    timeLabel: `Time lost to lap ${withLap}, s`,
    fields: {
      speed: { title: 'Speed', unit: 'km/h' },
      throttle: { title: 'Throttle', unit: null },
      brake: { title: 'Brake', unit: null },
      time: { title: `Time lost to lap ${withLap}`, unit: 's' }
    },
    ...(note === null ? {} : { timeNote: note }),
    mapTitle: `Map of the line of lap ${withLap} and the line of lap ${lap}`,
    mapTitleHidden: true,
    mapLabel: `Map of the line of lap ${withLap} and the line of lap ${lap}`,
    mapNotes: pit ? ['A gap in the line is the pit lane.'] : [],
    sideLabel: `The side distance of lap ${lap} is drawn ${SIDE_FACTOR} times larger.`,
    sideNote: `The line of lap ${lap} is drawn ${SIDE_FACTOR} times farther from the line of lap ${withLap} than it was, so that a difference of 1 m shows. The labels give the true distance at the largest point of each turn.`,
    dialogLabel: `Line of lap ${withLap} and line of lap ${lap} of ${raceName(race)}`,
    dialogHint: `Select a difference to find it on lap ${lap}.`,
    dialogLine: `Line of lap ${withLap}`,
    hint: 'Move the pointer or a finger across a chart, or focus a chart and use the arrow keys. The map point shows the same place.',
    metres,
    cursorText: (cursorSM, lengthM) => `Cursor at ${metres(cursorSM)} of ${metres(lengthM)}.`,
    describe: describeAgainst(withLap)
  };
}

function differencesWords(withLap: number): DifferencesWords {
  return {
    intro: () => `Turns in the order of the lap. Time lost is measured from telemetry. Lap ${withLap} is one of your laps, not the best possible line.`,
    none: 'No differences above the limits between these two laps.',
    emptyTurn: 'No difference',
    orderSwitch: false,
    neutralSmall: true,
    allTurns: true,
    wholeLabel: 'Whole lap',
    describe: describeAgainst(withLap)
  };
}

function CompareHeading({ lap, withLap }: { lap: RaceLap; withLap: RaceLap }) {
  const gapMs = lap.timeMs - withLap.timeMs;
  const seconds = (Math.abs(gapMs) / 1000).toFixed(GAP_DIGITS);
  return (
    <div className="race-compare-title">
      <h2>
        {gapMs === 0 ? (
          <>
            {`Lap ${lap.number} has the same time as `}
            <span className="race-nowrap">{`lap ${withLap.number}.`}</span>
          </>
        ) : (
          <>
            {`Lap ${lap.number} is `}
            <span className={gapMs > 0 ? 'race-gap-word slower' : 'race-gap-word faster'}>{`${seconds} s ${gapMs > 0 ? 'slower' : 'faster'}`}</span>
            {' than '}
            <span className="race-nowrap">{`lap ${withLap.number}`}</span>
          </>
        )}
      </h2>
    </div>
  );
}

function LapSelects({ race, lap, withLap }: { race: RaceDetail; lap: number; withLap: number }) {
  const { navigate } = useRouter();
  return (
    <div className="race-compare-selects">
      <div className="field">
        <label htmlFor="race-compare-lap" className="visually-hidden">
          Lap
        </label>
        <select id="race-compare-lap" value={lap} onChange={event => navigate(paths.raceCompare(race.id, Number(event.target.value), withLap))}>
          {race.laps
            .filter(item => item.number !== withLap)
            .map(item => (
              <option key={item.number} value={item.number}>
                {optionText(item)}
              </option>
            ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="race-compare-with" className="visually-hidden">
          Compare with
        </label>
        <select id="race-compare-with" value={withLap} onChange={event => navigate(paths.raceCompare(race.id, lap, Number(event.target.value)))}>
          {race.laps
            .filter(item => item.number !== lap)
            .map(item => (
              <option key={item.number} value={item.number}>
                {optionText(item)}
              </option>
            ))}
        </select>
      </div>
    </div>
  );
}

function errorMessage(error: Error): string {
  if (isRawMissing(error)) return RAW_MISSING_TEXT;
  if (error instanceof ApiError && error.code === 'no-match') return NO_MATCH_TEXT;
  return errorText(error);
}

function CompareBody({ race, comparison, lap, withLap }: { race: RaceDetail; comparison: LineComparison; lap: number; withLap: number }) {
  const wide = useWideLayout();
  const [cursorSM, setCursorNow, scrub] = useFrameCursor();
  const [selected, setSelected] = useState<number | null>(null);
  const words = useMemo(() => lapWords(race, lap, withLap), [race, lap, withLap]);
  const turnWords = useMemo(() => differencesWords(withLap), [withLap]);
  const lapLine = race.laps.some(item => item.number === withLap && item.closed);
  const select = useCallback(
    (index: number) => {
      setSelected(index);
      setCursorNow(comparison.findings[index]!.sM);
    },
    [comparison.findings, setCursorNow]
  );
  const map = <CompareMap title={raceName(race)} review={comparison} words={words} sideCueDistanceM={null} scaleSwitch={wide} cursorSM={cursorSM} selected={selected} onSelect={select} lapLine={lapLine} />;
  const charts = <CompareCharts review={comparison} words={words} side={false} sideCueDistanceM={null} cursorSM={cursorSM} onCursor={setCursorNow} onScrub={scrub} />;
  const differences = <Differences findings={comparison.findings} losses={comparison.turnLosses} selected={selected} words={turnWords} onSelect={select} />;
  if (!wide) {
    return (
      <div className="review-phone race-compare">
        {map}
        {differences}
        {charts}
      </div>
    );
  }
  return (
    <div className="wide race-compare">
      <div>
        {map}
        {charts}
      </div>
      <div>{differences}</div>
    </div>
  );
}

export function CompareTab({ race }: { race: RaceDetail }) {
  const { search } = useRouter();
  const lap = lapNumber(race, search.get('lap')) ?? defaultLap(race);
  const askedWith = lapNumber(race, search.get('with'));
  const withParam = askedWith !== null && askedWith !== lap ? askedWith : undefined;
  const compare = useResource(() => (lap === null ? Promise.resolve(null) : api.raceCompare(race.id, lap, withParam)), [race.id, lap, withParam]);
  if (race.laps.length < 2 || lap === null) return <p className="lede race-compare-none">{ONE_LAP_TEXT}</p>;
  const withLap = compare.data?.lap === lap ? compare.data.withLap : (withParam ?? defaultWith(race, lap));
  const lapRow = race.laps.find(item => item.number === lap)!;
  const withRow = race.laps.find(item => item.number === withLap) ?? null;
  const selects = withRow ? <LapSelects race={race} lap={lap} withLap={withRow.number} /> : null;
  return (
    <section className="race-compare-tab">
      {withRow ? (
        <div className="race-compare-head">
          <CompareHeading lap={lapRow} withLap={withRow} />
          {selects}
        </div>
      ) : null}
      {compare.error ? (
        <p className="error race-compare-problem">{errorMessage(compare.error)}</p>
      ) : compare.data && compare.data.lap === lap && withRow ? (
        <CompareBody key={`${lap}-${withRow.number}`} race={race} comparison={compare.data} lap={lap} withLap={withRow.number} />
      ) : (
        <p className="sub">Comparing the two laps…</p>
      )}
    </section>
  );
}
