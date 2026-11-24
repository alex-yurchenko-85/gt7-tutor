import { useEffect, useMemo, useRef, useState } from 'react';
import type { RaceSummary } from '@gt7/contracts';
import { api, ApiError } from '../../api/client.ts';
import { useLiveState } from '../../api/live.tsx';
import { ConfirmDialog } from '../../app/ConfirmDialog.tsx';
import { formatDay, formatHourMinute, formatTime, localDay } from '../../app/format.ts';
import { Icon } from '../../app/icons.tsx';
import { useWideLayout } from '../../app/layout.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { SelectionBar } from '../../app/SelectionBar.tsx';
import { lapsText } from './race-text.ts';
import './races.css';
import { t } from '../../app/i18n.ts';

type RaceDay = { key: string; races: RaceSummary[] };

function recordErrorText(error: unknown): string {
  return error instanceof ApiError && error.code === 'busy' ? t('races.busy') : errorText(error);
}

export function raceName(race: RaceSummary): string {
  return race.trackName ?? t('races.unnamed');
}

function factsText(race: RaceSummary, wide: boolean): string {
  const pitStops = race.pitStops > 0 ? t('common.count.pit-stop', { count: race.pitStops }) : null;
  return [race.carName, lapsText(race), pitStops, wide ? formatHourMinute(race.startedAt) : null].filter(Boolean).join(' · ');
}

function positionText(race: RaceSummary): string {
  return `${race.startPosition} → ${race.finishPosition}`;
}

type TrackCount = { name: string; count: number };

function trackCounts(races: RaceSummary[]): TrackCount[] {
  const counts = new Map<string, number>();
  for (const race of races) counts.set(raceName(race), (counts.get(raceName(race)) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

function byDay(races: RaceSummary[]): RaceDay[] {
  const days: RaceDay[] = [];
  for (const race of races) {
    const key = localDay(race.startedAt);
    const last = days.at(-1);
    if (last?.key === key) last.races.push(race);
    else days.push({ key, races: [race] });
  }
  return days;
}

function RaceRowContent({ race, wide }: { race: RaceSummary; wide: boolean }) {
  return (
    <>
      <span className="race-row-name">
        <b>{raceName(race)}</b>
        <span>{factsText(race, wide)}</span>
      </span>
      {wide ? (
        <>
          <span className="race-row-value">
            <b>{positionText(race)}</b>
            <span>{t('races.list.position')}</span>
          </span>
          <span className="race-row-value">
            <b>{formatTime(race.bestLapMs)}</b>
            <span>{t('races.list.best-lap')}</span>
          </span>
        </>
      ) : (
        <span className="race-row-value">
          <b>{formatTime(race.bestLapMs)}</b>
          <span>{t('races.list.position-value', { position: positionText(race) })}</span>
        </span>
      )}
    </>
  );
}

function DeleteRacesDialog({ ids, onKeep, onDeleted }: { ids: string[]; onKeep(): void; onDeleted(): void }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setWorking(true);
    setError(null);
    try {
      await api.deleteRaces(ids);
      onDeleted();
    } catch (failure) {
      setError(errorText(failure));
      setWorking(false);
    }
  };
  return (
    <ConfirmDialog
      title={t('races.delete.title', { count: ids.length })}
      keepLabel={t('races.delete.keep', { count: ids.length })}
      confirmLabel={t('races.delete.confirm', { count: ids.length })}
      working={working}
      error={error}
      onKeep={onKeep}
      onConfirm={confirm}
    >
      <p>{t('races.delete.text', { count: ids.length })}</p>
    </ConfirmDialog>
  );
}

export function RacesView() {
  const wide = useWideLayout();
  const { navigate } = useRouter();
  const races = useResource(() => api.races(), []);
  const recording = useLiveState(({ state }) => state?.mode === 'race-waiting' || state?.mode === 'race-running');
  const lastRaceId = useLiveState(({ state }) => state?.lastRaceId ?? null);
  const seenRaceId = useRef(lastRaceId);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  useEffect(() => {
    if (seenRaceId.current === lastRaceId) return;
    seenRaceId.current = lastRaceId;
    races.reload();
  }, [lastRaceId, races.reload]);
  const [track, setTrack] = useState('');
  const list = races.data;
  const tracks = useMemo(() => trackCounts(list ?? []), [list]);
  const filtering = tracks.length > 1;
  const activeTrack = filtering && tracks.some(item => item.name === track) ? track : '';
  const shown = useMemo(() => (activeTrack ? (list ?? []).filter(race => raceName(race) === activeTrack) : (list ?? [])), [list, activeTrack]);
  const shownPicked = shown.filter(race => picked.has(race.id));
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (!next.delete(id)) next.add(id);
    setPicked(next);
  };
  const chooseTrack = (name: string) => {
    setTrack(name);
    setPicked(new Set());
  };
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };
  const deleted = () => {
    setConfirming(false);
    stopSelecting();
    races.reload();
  };
  const record = async () => {
    setStarting(true);
    setRecordError(null);
    try {
      await api.recordRace();
      navigate(paths.raceRecord());
    } catch (failure) {
      setRecordError(recordErrorText(failure));
      setStarting(false);
    }
  };
  return (
    <div className="races-home">
      {wide ? <h1>{t('races.title')}</h1> : null}
      <section className={selecting ? 'my-races selecting-page' : 'my-races'}>
        <div className="my-races-head">
          <h2>
            {t('races.my-races')} {list ? <span className="count">{list.length}</span> : null}
          </h2>
          <div className="my-races-actions">
            {list && list.length > 0 && !selecting ? (
              <button type="button" className="btn ghost inline" onClick={() => setSelecting(true)}>
                <Icon name="select" size={16} />
                {t('races.select')}
              </button>
            ) : null}
            {recording ? (
              <button type="button" className="btn inline" disabled>
                {t('races.recording')}
              </button>
            ) : (
              <button type="button" className="btn inline" disabled={starting} onClick={record}>
                {wide ? t('races.record-wide') : t('races.record')}
              </button>
            )}
          </div>
        </div>
        {recordError ? (
          <p className="error" role="alert">
            {recordError}
          </p>
        ) : null}
        {races.error ? <p className="error">{errorText(races.error)}</p> : null}
        {!list && !races.error ? <p className="sub">{t('races.reading')}</p> : null}
        {list && list.length === 0 ? (
          <div className="panel races-empty">
            <p className="lede">{t('races.empty.title')}</p>
            <p>{wide ? t('races.empty.text-wide') : t('races.empty.text')}</p>
          </div>
        ) : null}
        {list && filtering ? (
          <div className="races-filter">
            <label htmlFor="races-track">{t('races.list.track-label')}</label>
            <select id="races-track" className="input track-filter" value={activeTrack} onChange={event => chooseTrack(event.target.value)}>
              <option value="">{t('races.list.all-tracks', { count: list.length })}</option>
              {tracks.map(item => (
                <option key={item.name} value={item.name}>
                  {t('races.list.track-option', { track: item.name, count: item.count })}
                </option>
              ))}
            </select>
            <span className="sub">{activeTrack ? t('races.list.count-filtered', { shown: shown.length, count: list.length }) : t('races.list.count', { count: list.length })}</span>
          </div>
        ) : null}
        {byDay(shown).map(day => (
          <div key={day.key} className="race-day">
            <h3>{formatDay(day.key)}</h3>
            <div className="race-list">
              {day.races.map(race =>
                selecting ? (
                  <label key={race.id} className={picked.has(race.id) ? 'race-row selecting picked' : 'race-row selecting'}>
                    <input type="checkbox" className="pick-box" checked={picked.has(race.id)} onChange={() => toggle(race.id)} />
                    <RaceRowContent race={race} wide={wide} />
                  </label>
                ) : (
                  <Link key={race.id} to={paths.race(race.id)} className="race-row">
                    <RaceRowContent race={race} wide={wide} />
                    <Icon name="chevron-right" size={18} />
                  </Link>
                )
              )}
            </div>
          </div>
        ))}
        {selecting ? <SelectionBar count={shownPicked.length} action={t('races.delete-selected', { count: shownPicked.length })} onCancel={stopSelecting} onAction={() => setConfirming(true)} /> : null}
        {confirming ? <DeleteRacesDialog ids={shownPicked.map(race => race.id)} onKeep={() => setConfirming(false)} onDeleted={deleted} /> : null}
      </section>
    </div>
  );
}
