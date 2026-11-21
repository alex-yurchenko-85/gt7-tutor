import { useEffect, useRef, useState } from 'react';
import type { RaceSummary } from '@gt7/contracts';
import { api, ApiError } from '../../api/client.ts';
import { useLiveState } from '../../api/live.tsx';
import { ConfirmDialog } from '../../app/ConfirmDialog.tsx';
import { formatDay, formatHourMinute, formatTime, localDay } from '../../app/format.ts';
import { Icon } from '../../app/icons.tsx';
import { useWideLayout } from '../../app/layout.ts';
import { counted } from '../../app/plural.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { SelectionBar } from '../../app/SelectionBar.tsx';
import { lapsText } from './race-text.ts';
import './races.css';

type RaceDay = { key: string; races: RaceSummary[] };

const BUSY_TEXT = 'A recording or a training runs. Stop it first.';

function recordErrorText(error: unknown): string {
  return error instanceof ApiError && error.code === 'busy' ? BUSY_TEXT : errorText(error);
}

export function raceName(race: RaceSummary): string {
  return race.trackName ?? 'Race without a track name';
}

function factsText(race: RaceSummary, wide: boolean): string {
  const pitStops = race.pitStops > 0 ? counted(race.pitStops, 'pit stop') : null;
  return [race.carName, lapsText(race), pitStops, wide ? formatHourMinute(race.startedAt) : null].filter(Boolean).join(' · ');
}

function positionText(race: RaceSummary): string {
  return `${race.startPosition} → ${race.finishPosition}`;
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
            <span>position</span>
          </span>
          <span className="race-row-value">
            <b>{formatTime(race.bestLapMs)}</b>
            <span>best lap</span>
          </span>
        </>
      ) : (
        <span className="race-row-value">
          <b>{formatTime(race.bestLapMs)}</b>
          <span>position {positionText(race)}</span>
        </span>
      )}
    </>
  );
}

function DeleteRacesDialog({ ids, onKeep, onDeleted }: { ids: string[]; onKeep(): void; onDeleted(): void }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const one = ids.length === 1;
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
      title={`Delete ${counted(ids.length, 'race')}?`}
      keepLabel={one ? 'Keep race' : 'Keep races'}
      confirmLabel={one ? 'Delete race' : 'Delete races'}
      working={working}
      error={error}
      onKeep={onKeep}
      onConfirm={confirm}
    >
      <p>The laps, the pit stops and the places off the track of {one ? 'this race' : 'these races'} go. Clean up captures frees the disk space later.</p>
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
  const list = races.data;
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (!next.delete(id)) next.add(id);
    setPicked(next);
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
      <h1 className={wide ? undefined : 'visually-hidden'}>Races</h1>
      <section className={selecting ? 'my-races selecting-page' : 'my-races'} aria-labelledby="races-title">
        <div className="my-races-head">
          <h2 id="races-title">
            My races {list ? <span className="count">{list.length}</span> : null}
          </h2>
          <div className="my-races-actions">
            {list && list.length > 0 && !selecting ? (
              <button type="button" className="btn ghost inline" onClick={() => setSelecting(true)}>
                <Icon name="select" size={16} />
                Select
              </button>
            ) : null}
            {recording ? (
              <button type="button" className="btn inline" disabled>
                Recording…
              </button>
            ) : (
              <button type="button" className="btn inline" aria-label="Record a race" disabled={starting} onClick={record}>
                {wide ? 'Record a race' : 'Record'}
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
        {!list && !races.error ? <p className="sub">Reading your races…</p> : null}
        {list && list.length === 0 ? (
          <div className="panel races-empty">
            <p className="lede">No races yet.</p>
            <p>Select {wide ? 'Record a race' : 'Record'}, then start a race by laps in the game. The recording starts and stops with the race.</p>
          </div>
        ) : null}
        {byDay(list ?? []).map(day => (
          <div key={day.key} className="race-day" role="group" aria-labelledby={`race-day-${day.key}`}>
            <h3 id={`race-day-${day.key}`}>{formatDay(day.key)}</h3>
            <div className="race-list">
              {day.races.map(race =>
                selecting ? (
                  <label key={race.id} className={picked.has(race.id) ? 'race-row selecting picked' : 'race-row selecting'}>
                    <input type="checkbox" className="pick-box" aria-label={`Select ${raceName(race)}`} checked={picked.has(race.id)} onChange={() => toggle(race.id)} />
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
        {selecting ? <SelectionBar count={picked.size} action={`Delete ${counted(picked.size, 'race')}`} onCancel={stopSelecting} onAction={() => setConfirming(true)} /> : null}
        {confirming ? <DeleteRacesDialog ids={(list ?? []).filter(race => picked.has(race.id)).map(race => race.id)} onKeep={() => setConfirming(false)} onDeleted={deleted} /> : null}
      </section>
    </div>
  );
}
