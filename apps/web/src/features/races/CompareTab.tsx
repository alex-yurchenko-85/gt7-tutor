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
import { isRawMissing, rawMissingText } from './race-errors.ts';
import { t } from '../../app/i18n.ts';
import { Rich } from '../../app/rich-text.tsx';

const GAP_DIGITS = 3;

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
  return t('races.compare.option', { lap: lap.number, time: formatTime(lap.timeMs) });
}

function describeAgainst(withLap: number): (difference: Difference) => string {
  return difference => (difference.kind === 'off-line' ? t('races.compare.off-line', { size: sizeText(difference.size, difference.unit), lap: withLap }) : differenceText(difference));
}

function timeNote(race: RaceDetail, lap: number, withLap: number): string | null {
  const compared = race.laps.find(item => item.number === lap);
  const other = race.laps.find(item => item.number === withLap);
  const outLap = compared?.pitOut || other?.pitOut;
  if ((compared?.pitIn || other?.pitIn) && outLap) return t('races.compare.pit-in-out');
  if (compared?.pitIn || other?.pitIn) return t('races.compare.pit-in');
  if (compared?.pitOut && other?.pitOut) return t('races.compare.both-out', { lap: withLap });
  if (compared?.pitOut) return t('races.compare.this-out');
  if (other?.pitOut) return t('races.compare.other-out', { lap: withLap });
  return null;
}

function lapWords(race: RaceDetail, lap: number, withLap: number): LineWords {
  const note = timeNote(race, lap, withLap);
  const pit = race.laps.some(item => (item.number === lap || item.number === withLap) && (item.pitIn || item.pitOut));
  const metres = groupedMetres;
  return {
    referenceName: t('races.compare.lap-name', { lap: withLap }),
    youName: t('races.compare.lap-name', { lap }),
    referenceLegend: withLap === race.bestLap ? t('races.compare.best-legend', { lap: withLap }) : t('races.compare.lap-name', { lap: withLap }),
    youLegend: t('races.compare.lap-name', { lap }),
    timeLabel: t('races.compare.time-label', { lap: withLap }),
    fields: {
      speed: { title: t('races.compare.speed'), unit: t('races.compare.kph') },
      throttle: { title: t('races.compare.throttle'), unit: null },
      brake: { title: t('races.compare.brake'), unit: null },
      time: { title: t('races.compare.time', { lap: withLap }), unit: t('races.compare.seconds') }
    },
    ...(note === null ? {} : { timeNote: note }),
    mapTitle: t('races.compare.map', { with: withLap, lap }),
    mapTitleHidden: true,
    mapLabel: t('races.compare.map', { with: withLap, lap }),
    mapNotes: pit ? [t('races.compare.map-pit')] : [],
    sideLabel: t('races.compare.side-label', { lap, factor: SIDE_FACTOR }),
    sideNote: t('races.compare.side-note', { lap, with: withLap, factor: SIDE_FACTOR }),
    dialogLabel: t('races.compare.dialog-label', { with: withLap, lap, race: raceName(race) }),
    dialogHint: t('races.compare.dialog-hint', { lap }),
    dialogLine: t('races.compare.dialog-line', { with: withLap }),
    hint: t('races.compare.hint'),
    metres,
    cursorText: (cursorSM, lengthM) => t('races.cursor', { place: metres(cursorSM), length: metres(lengthM) }),
    describe: describeAgainst(withLap)
  };
}

function differencesWords(withLap: number): DifferencesWords {
  return {
    intro: () => t('races.compare.intro', { lap: withLap }),
    none: t('races.compare.none'),
    emptyTurn: t('races.compare.no-difference'),
    orderSwitch: false,
    neutralSmall: true,
    allTurns: true,
    wholeLabel: t('races.compare.whole'),
    describe: describeAgainst(withLap)
  };
}

function CompareHeading({ lap, withLap }: { lap: RaceLap; withLap: RaceLap }) {
  const gapMs = lap.timeMs - withLap.timeMs;
  const seconds = (Math.abs(gapMs) / 1000).toFixed(GAP_DIGITS);
  const other = <span className="race-nowrap">{t('races.compare.lap-name', { lap: withLap.number })}</span>;
  return (
    <div className="race-compare-title">
      <h2>
        {gapMs === 0 ? (
          <Rich k="races.compare.same" params={{ lap: lap.number }} parts={{ with: other }} />
        ) : (
          <Rich
            k="races.compare.gap"
            params={{ lap: lap.number }}
            parts={{
              gap: <span className={gapMs > 0 ? 'race-gap-word slower' : 'race-gap-word faster'}>{t(gapMs > 0 ? 'races.compare.slower' : 'races.compare.faster', { seconds })}</span>,
              with: other
            }}
          />
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
          {t('races.compare.lap')}
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
          {t('races.compare.with')}
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
  if (isRawMissing(error)) return rawMissingText();
  if (error instanceof ApiError && error.code === 'no-match') return t('races.compare.no-match');
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
  if (race.laps.length < 2 || lap === null) return <p className="lede race-compare-none">{t('races.compare.one-lap')}</p>;
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
        <p className="sub">{t('races.compare.comparing')}</p>
      )}
    </section>
  );
}
