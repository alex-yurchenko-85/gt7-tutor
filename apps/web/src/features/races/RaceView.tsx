import { useState } from 'react';
import type { RaceDetail, RaceSummary } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { formatDateTime, formatTime, groupedMetres } from '../../app/format.ts';
import { LoadProblem } from '../../app/NotFound.tsx';
import { useResource } from '../../app/resource.ts';
import { Link, paths, type RaceTab } from '../../app/router.tsx';
import { CompareTab } from './CompareTab.tsx';
import { GoldenTab } from './GoldenTab.tsx';
import { LapsTab } from './LapsTab.tsx';
import { OffTrackTab } from './OffTrackTab.tsx';
import { RaceBand, type BandValue } from './RaceBand.tsx';
import { raceName } from './RacesView.tsx';
import { lapsText, lastLap, positionCaption } from './race-text.ts';
import { TrackNameDialog } from './TrackNameDialog.tsx';
import './races.css';
import { t } from '../../app/i18n.ts';

function tabs(): { tab: RaceTab; label: string }[] {
  return [
    { tab: 'laps', label: t('races.tab.laps') },
    { tab: 'compare', label: t('races.tab.compare') },
    { tab: 'off-track', label: t('races.tab.off-track') },
    { tab: 'golden', label: t('races.tab.golden') }
  ];
}

function factsText(race: RaceSummary): string {
  return [lapsText(race), t('common.count.car', { count: race.cars }), race.pitStops > 0 ? t('common.count.pit-stop', { count: race.pitStops }) : null].filter(Boolean).join(' · ');
}

function lengthText(race: RaceDetail): string | null {
  return race.lapLengthM === null ? null : t('races.lap-length', { length: groupedMetres(race.lapLengthM) });
}

function SummaryBand({ race }: { race: RaceDetail }) {
  const values: BandValue[] = [
    { value: formatTime(race.raceMs), caption: race.complete ? t('races.band.race-time') : t('races.band.recorded-time'), tone: '' },
    { value: formatTime(race.bestLapMs), caption: t('races.band.best-lap', { lap: race.bestLap }), tone: 'yellow' },
    { value: `${race.startPosition} → ${race.finishPosition}`, caption: positionCaption(race.firstLap, lastLap(race), race.complete), tone: '' }
  ];
  const title = race.carName ?? t('races.band.race');
  return <RaceBand label={title} title={title} facts={factsText(race)} values={values} />;
}

function RaceHeader({ race, tab, onName }: { race: RaceDetail; tab: RaceTab; onName(): void }) {
  const name = raceName(race);
  const text = lengthText(race);
  return (
    <header className="exercise-header race-header">
      <nav className="breadcrumb" aria-label={t('common.breadcrumb')}>
        <Link to={paths.races()}>{t('races.breadcrumb.races')}</Link> / {name}
      </nav>
      <h1>{name}</h1>
      <p className="exercise-where sub">
        <span>
          {formatDateTime(race.startedAt)}
          {text ? ` · ${text}` : ''}
        </span>{' '}
        <button type="button" className="text-button race-name-button" onClick={onName}>
          {race.trackName === null ? t('races.name-track') : t('races.change-name')}
        </button>
      </p>
      <nav className="exercise-tabs" aria-label={t('races.tabs')}>
        {tabs().map(item => (
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
  if (!race.data) return <p className="sub">{t('races.reading-race')}</p>;
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
      ) : tab === 'golden' ? (
        <GoldenTab race={detail} />
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
