import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveRace } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { useLiveState, type LiveSnapshot } from '../../api/live.tsx';
import { useDemo } from '../../app/demo.tsx';
import { formatTime } from '../../app/format.ts';
import { useImmersive } from '../../app/immersive.tsx';
import { useWideLayout } from '../../app/layout.ts';
import { errorText } from '../../app/resource.ts';
import { paths, useRouter } from '../../app/router.tsx';
import { telemetryStatus } from '../../app/status.ts';
import { LapCircles } from './LapCircles.tsx';
import { RaceTrail } from './RaceTrail.tsx';
import { positionCaption } from './race-text.ts';
import { t } from '../../app/i18n.ts';
import { Rich } from '../../app/rich-text.tsx';
import '../drive/drive.css';
import './race-record.css';

const OPEN_AFTER_FINISH_MS = 2400;

const NO_RACE_MS = 1000;
const CIRCLE_PHASES: LiveRace['phase'][] = ['grid', 'joined', 'lap', 'stopped'];
const RECORDING_PHASES: LiveRace['phase'][] = ['grid', 'joined', 'lap'];
const DASH = '\u2013';

function raceKey({ state }: LiveSnapshot): string | null {
  const race = state?.race;
  if (!race) return null;
  return JSON.stringify({
    ...race,
    x: 0,
    z: 0,
    lapTimeMs: Math.floor(race.lapTimeMs / 100) * 100,
    fuel: Math.round(race.fuel),
    fuelLapsLeft: race.fuelLapsLeft === null ? null : Math.round(race.fuelLapsLeft * 10) / 10
  });
}

function useStageRace(): LiveRace | null {
  const key = useLiveState(raceKey);
  return useMemo(() => (key === null ? null : (JSON.parse(key) as LiveRace)), [key]);
}

function prefersMotion(): boolean {
  return !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
}

function tenths(ms: number): string {
  return formatTime(Math.floor(ms / 100) * 100, 1);
}

function lapsMs(race: LiveRace): number {
  return race.laps.reduce((total, lap) => total + lap.timeMs, 0);
}

type Stat = { id: string; value: string; caption: string; tone?: 'yellow'; fuel?: boolean };

function StatList({ stats, fuelBar, className = 'race-stats' }: { stats: Stat[]; fuelBar: number | null; className?: string }) {
  return (
    <div className={className}>
      {stats.map(stat => (
        <div key={stat.id} className={['race-stat', stat.tone, stat.fuel ? 'fuel' : ''].filter(Boolean).join(' ')}>
          <b>{stat.value}</b>
          <span>{stat.caption}</span>
          {stat.fuel && fuelBar !== null ? (
            <div className="race-fuel-bar">
              <i style={{ width: `${fuelBar}%` }} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function livePosition(race: LiveRace): Stat[] {
  if (race.position < 1) return [];
  return [{ id: 'position', value: t('races.stage.position', { position: race.position }), caption: race.cars >= 1 ? t('races.stage.of-cars', { cars: race.cars }) : t('races.stage.position-caption') }];
}

function positionStat(race: LiveRace): Stat[] {
  if (race.position < 1) return [];
  if (race.startPosition === null || race.startPosition < 1) return livePosition(race);
  const lastLap = race.laps.at(-1)?.number ?? race.lap;
  const caption = positionCaption(race.firstRecordedLap ?? lastLap, lastLap, false);
  return [{ id: 'position', value: `${race.startPosition} → ${race.position}`, caption }];
}

function bestStat(race: LiveRace): Stat[] {
  return race.bestLapMs === null ? [] : [{ id: 'best-lap', value: formatTime(race.bestLapMs), caption: t('races.stage.best-lap-number', { lap: race.bestLap ?? '' }), tone: 'yellow' }];
}

function statsOf(race: LiveRace): Stat[] {
  switch (race.phase) {
    case 'waiting':
      return [];
    case 'grid':
      return [
        { id: 'this-lap', value: tenths(Math.max(0, race.lapTimeMs)), caption: t('races.stage.this-lap') },
        ...livePosition(race),
        { id: 'last-lap', value: DASH, caption: t('races.stage.last-lap') },
        { id: 'best-lap', value: DASH, caption: t('races.stage.best-lap') },
        ...(race.fuel > 0 ? [{ id: 'fuel', value: String(Math.round(race.fuel)), caption: t('races.stage.fuel'), fuel: true }] : [])
      ];
    case 'joined':
      return [{ id: 'this-lap', value: tenths(race.lapTimeMs), caption: t('races.stage.this-lap') }, ...livePosition(race)];
    case 'lap':
      return [
        { id: 'this-lap', value: tenths(race.lapTimeMs), caption: t('races.stage.this-lap') },
        ...livePosition(race),
        ...(race.lastLapMs === null ? [] : [{ id: 'last-lap', value: formatTime(race.lastLapMs), caption: t('races.stage.last-lap') }]),
        ...bestStat(race),
        { id: 'fuel', value: String(Math.round(race.fuel)), caption: race.fuelLapsLeft === null ? t('races.stage.fuel') : t('races.stage.fuel-laps', { laps: race.fuelLapsLeft.toFixed(1) }), fuel: true }
      ];
    case 'finished':
      if (race.laps.length === 0) return [];
      return [{ id: 'time', value: formatTime(lapsMs(race)), caption: race.firstRecordedLap === 1 ? t('races.stage.race-time') : t('races.stage.recorded-time') }, ...bestStat(race)];
    case 'stopped':
      if (race.laps.length === 0) return [];
      return [{ id: 'time', value: formatTime(lapsMs(race)), caption: t('races.stage.recorded-time') }, ...bestStat(race), ...positionStat(race)];
  }
}

function statusDot(recording: boolean, packets: boolean): { colour: 'green' | 'grey' | 'red' | 'yellow'; word: string } {
  if (recording) return packets ? { colour: 'red', word: t('races.stage.recording') } : { colour: 'yellow', word: t('races.stage.recording-no-telemetry') };
  return packets ? { colour: 'green', word: t('races.stage.telemetry') } : { colour: 'grey', word: t('races.stage.no-telemetry') };
}

function Word({ race }: { race: LiveRace }) {
  switch (race.phase) {
    case 'waiting':
      return <h1 className="race-word dim">{t('races.stage.waiting')}</h1>;
    case 'finished':
      if (race.position < 1) return <h1 className="race-word">{t('races.stage.finished')}</h1>;
      return (
        <>
          <p className="race-finished">{t('races.stage.finished')}</p>
          <h1 className="race-word yellow rise">
            {race.cars >= 1 ? (
              <Rich k="races.stage.finished-position-of" params={{ position: race.position }} parts={{ of: <span className="race-of">{t('races.stage.word-of', { total: race.cars })}</span> }} />
            ) : (
              t('races.stage.finished-position', { position: race.position })
            )}
          </h1>
        </>
      );
    case 'stopped':
      return <h1 className="race-word">{t('races.stage.stopped')}</h1>;
    default:
      return (
        <h1 className={race.phase === 'joined' ? 'race-word dim' : 'race-word yellow'}>
          <Rich k="races.stage.lap" params={{ lap: Math.max(1, race.lap) }} parts={{ of: <span className="race-of">{t('races.stage.word-of', { total: race.lapsInRace })}</span> }} />
        </h1>
      );
  }
}

function Kicker({ race }: { race: LiveRace }) {
  if (race.phase === 'joined') {
    return (
      <p className="race-kicker dim">
        <span className="race-dim-dot" />
        {t('races.stage.joined')}
      </p>
    );
  }
  return null;
}

function finishedLines(race: LiveRace): string[] {
  const start = race.firstRecordedLap === 1 && race.startPosition !== null && race.startPosition >= 1 ? race.startPosition : null;
  const saved = race.savedRaceId !== null;
  if (start === null) return saved ? [t('races.stage.finished-saved')] : [];
  return [saved ? t('races.stage.finished-start-saved', { position: start }) : t('races.stage.finished-start', { position: start })];
}

function leadText(race: LiveRace): string[] {
  switch (race.phase) {
    case 'waiting':
      return [
        race.unsupported ? t('races.stage.unsupported') : t('races.stage.start'),
        t('races.stage.waiting-note')
      ];
    case 'grid':
      return [];
    case 'joined':
      return [t('races.stage.joined-note')];
    case 'lap':
      return [];
    case 'finished':
      return finishedLines(race);
    case 'stopped':
      return [
        race.savedRaceId === null
          ? race.laps.length > 0
            ? t('races.stage.not-stored')
            : t('races.stage.no-lap')
          : t('races.stage.stopped-saved', { done: race.laps.length, count: race.lapsInRace })
      ];
  }
}

function useNoRaceRedirect(race: LiveRace | null) {
  const { navigate } = useRouter();
  const known = useLiveState(({ state }) => state !== null);
  useEffect(() => {
    if (race || !known) return;
    const timer = window.setTimeout(() => navigate(paths.races(), { replace: true }), NO_RACE_MS);
    return () => window.clearTimeout(timer);
  }, [race === null, known, navigate]);
}

export function RaceRecordView() {
  useImmersive(true);
  const race = useStageRace();
  useNoRaceRedirect(race);
  const wide = useWideLayout();
  const demo = useDemo() !== null;
  const telemetry = useLiveState(({ state, connected }) => telemetryStatus(state, connected, demo));
  const { navigate } = useRouter();
  const [motion] = useState(prefersMotion);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const opened = useRef(false);

  const close = useCallback(
    async (target: string): Promise<boolean> => {
      setBusy(true);
      setProblem(null);
      try {
        await api.closeRaceRecord();
        navigate(target);
        return true;
      } catch (error) {
        setProblem(errorText(error));
        setBusy(false);
        return false;
      }
    },
    [navigate]
  );

  const savedRaceId = race?.savedRaceId ?? null;
  const openRace = useCallback(() => {
    if (opened.current || savedRaceId === null) return;
    opened.current = true;
    void close(paths.race(savedRaceId)).then(done => {
      if (!done) opened.current = false;
    });
  }, [close, savedRaceId]);

  const closeStage = useCallback(() => {
    opened.current = true;
    void close(paths.races()).then(done => {
      if (!done) opened.current = false;
    });
  }, [close]);

  useEffect(() => {
    if (race?.phase !== 'finished' || savedRaceId === null) return;
    const timer = window.setTimeout(openRace, OPEN_AFTER_FINISH_MS);
    return () => window.clearTimeout(timer);
  }, [race?.phase, savedRaceId, openRace]);

  if (!race) return <div className="drive-stage race-stage" data-surface="night" />;

  const stop = async () => {
    const waiting = race.phase === 'waiting';
    setBusy(true);
    setProblem(null);
    try {
      await api.stopRace();
      if (waiting) navigate(paths.races());
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const ended = race.phase === 'finished' || race.phase === 'stopped';
  const showMap = race.phase === 'grid' || race.phase === 'joined' || race.phase === 'lap';
  const stats = statsOf(race);
  const fuel = wide ? stats.filter(stat => stat.fuel) : [];
  const values = wide ? stats.filter(stat => !stat.fuel) : stats;
  const circles = CIRCLE_PHASES.includes(race.phase) && race.lapsInRace > 0;
  const laps = circles ? (
    <LapCircles lapsInRace={race.lapsInRace} firstRecordedLap={race.firstRecordedLap} laps={race.laps} lap={Math.max(1, race.lap)} bestLap={race.bestLap} running={race.phase !== 'stopped'} />
  ) : null;
  const recording = RECORDING_PHASES.includes(race.phase);
  const dot = statusDot(recording, telemetry.tone === 'on');
  const subline = race.phase !== 'waiting' && race.carName ? race.carName : t('races.stage.race-recording');
  const button = race.phase === 'waiting' ? t('races.stage.cancel') : ended ? t('races.stage.close') : t('races.stage.stop');
  const onButton = ended ? closeStage : () => void stop();

  return (
    <div className={['drive-stage', 'race-stage', motion ? 'motion' : '', showMap ? 'with-map' : ''].filter(Boolean).join(' ')} data-surface="night" data-phase={race.phase}>
      <div className="stage-top">
        <div className="stage-title race-status">
          <p className="race-status-word" title={telemetry.text}>
            <span className={`race-dot ${dot.colour}`} />
            {dot.word}
          </p>
          <p className="race-status-sub">{subline}</p>
        </div>
        <button type="button" className="stage-button" onClick={onButton} disabled={busy}>
          {button}
        </button>
      </div>
      <div className="race-stage-main">
        <Kicker race={race} />
        <Word race={race} />
        {leadText(race).map((text, index) => (
          <p key={text} className={index === 0 ? 'race-lead' : 'race-note'}>
            {text}
          </p>
        ))}
        {values.length > 0 || (wide && circles) ? (
          <div className="race-values">
            {values.length > 0 ? <StatList stats={values} fuelBar={null} /> : null}
            {fuel.length > 0 ? <StatList stats={fuel} fuelBar={Math.max(0, Math.min(100, race.fuel))} className="race-stats race-fuel" /> : null}
            {wide ? laps : null}
          </div>
        ) : null}
      </div>
      {showMap ? (
        <div className="race-stage-map">
          <RaceTrail fadeMs={race.laps.length > 0 ? race.lastLapMs : null} />
        </div>
      ) : null}
      {wide || !circles ? null : <div className="race-stage-laps">{laps}</div>}
      <div className="race-stage-end">
        {ended && savedRaceId !== null ? (
          <div className="race-open">
            <button type="button" className="stage-button primary race-open-button" onClick={openRace} disabled={busy}>
              {t('races.stage.open')}
            </button>
            {race.phase === 'finished' ? <span className="race-note">{t('races.stage.opens')}</span> : null}
          </div>
        ) : null}
        {race.phase === 'finished' && savedRaceId !== null ? (
          <div className="race-open-bar">
            <i />
          </div>
        ) : null}
        {race.phase === 'stopped' && savedRaceId === null ? (
          <button type="button" className="stage-button" onClick={closeStage} disabled={busy}>
            {t('races.stage.back')}
          </button>
        ) : null}
        {problem ? (
          <p className="stage-alert" role="alert">
            {problem}
          </p>
        ) : null}
      </div>
    </div>
  );
}
