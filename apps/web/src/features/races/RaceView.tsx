import { useState } from 'react';
import type { RaceDetail, RaceSummary } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { counted } from '../../app/plural.ts';
import { formatDateTime, formatTime, groupedMetres } from '../../app/format.ts';
import { LoadProblem } from '../../app/NotFound.tsx';
import { useResource } from '../../app/resource.ts';
import { Link, paths, type RaceTab } from '../../app/router.tsx';
import { CompareTab } from './CompareTab.tsx';
import { LapsTab } from './LapsTab.tsx';
import { OffTrackTab } from './OffTrackTab.tsx';
import { raceName } from './RacesView.tsx';
import { lapsText, lastLap, positionCaption } from './race-text.ts';
import { TrackNameDialog } from './TrackNameDialog.tsx';
import './races.css';

const TABS: { tab: RaceTab; label: string }[] = [
  { tab: 'laps', label: 'Laps' },
  { tab: 'compare', label: 'Compare' },
  { tab: 'off-track', label: 'Off the track' }
];

function factsText(race: RaceSummary): string {
  return [lapsText(race), counted(race.cars, 'car'), race.pitStops > 0 ? counted(race.pitStops, 'pit stop') : null].filter(Boolean).join(' · ');
}

function lengthText(race: RaceDetail): string | null {
  return race.lapLengthM === null ? null : `lap length ${groupedMetres(race.lapLengthM)}`;
}

function SummaryBand({ race }: { race: RaceDetail }) {
  const values = [
    { value: formatTime(race.raceMs), caption: race.complete ? 'race time' : 'time of the recorded laps', tone: '' },
    { value: formatTime(race.bestLapMs), caption: `best lap · lap ${race.bestLap}`, tone: 'yellow' },
    { value: `${race.startPosition} → ${race.finishPosition}`, caption: positionCaption(race.firstLap, lastLap(race), race.complete), tone: '' }
  ];
  const title = race.carName ?? 'Race';
  return (
    <section className="race-band" aria-label={title}>
      <div className="race-band-car">
        <h2>{title}</h2>
        <p>{factsText(race)}</p>
      </div>
      <div className="race-band-values">
        {values.map(item => (
          <div key={item.caption} className={['race-band-value', item.tone].filter(Boolean).join(' ')}>
            <b>{item.value}</b>
            <span>{item.caption}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RaceHeader({ race, tab, onName }: { race: RaceDetail; tab: RaceTab; onName(): void }) {
  const name = raceName(race);
  const text = lengthText(race);
  return (
    <header className="exercise-header race-header">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={paths.races()}>Races</Link> / {name}
      </nav>
      <h1>{name}</h1>
      <p className="exercise-where sub">
        <span>
          {formatDateTime(race.startedAt)}
          {text ? ` · ${text}` : ''}
        </span>{' '}
        <button type="button" className="text-button race-name-button" onClick={onName}>
          {race.trackName === null ? 'Name the track' : 'Change the name'}
        </button>
      </p>
      <nav className="exercise-tabs" aria-label="Race">
        {TABS.map(item => (
          <Link key={item.tab} to={paths.race(race.id, item.tab)} current={item.tab === tab}>
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function RaceView({ raceId, tab }: { raceId: string; tab: RaceTab }) {
  const race = useResource(() => api.race(raceId), [raceId]);
  const [naming, setNaming] = useState(false);
  if (race.error) return <LoadProblem error={race.error} kind="race" />;
  if (!race.data) return <p className="sub">Reading the race…</p>;
  const detail = race.data;
  const saved = (summary: RaceSummary) => {
    race.replace({ ...detail, ...summary, laps: detail.laps });
    setNaming(false);
  };
  return (
    <div className="race-page">
      <RaceHeader race={detail} tab={tab} onName={() => setNaming(true)} />
      {tab === 'compare' ? (
        <CompareTab race={detail} />
      ) : tab === 'off-track' ? (
        <OffTrackTab race={detail} />
      ) : (
        <>
          <SummaryBand race={detail} />
          <LapsTab race={detail} />
        </>
      )}
      {naming ? <TrackNameDialog race={detail} onKeep={() => setNaming(false)} onSaved={saved} /> : null}
    </div>
  );
}
