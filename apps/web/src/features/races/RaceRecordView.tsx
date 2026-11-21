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

type Stat = { value: string; caption: string; tone?: 'yellow'; fuel?: boolean };

function StatList({ stats, fuelBar, className = 'race-stats' }: { stats: Stat[]; fuelBar: number | null; className?: string }) {
  return (
    <div className={className}>
      {stats.map(stat => (
        <div key={stat.caption} className={['race-stat', stat.tone, stat.fuel ? 'fuel' : ''].filter(Boolean).join(' ')}>
          <b>{stat.value}</b>
          <span>{stat.caption}</span>
          {stat.fuel && fuelBar !== null ? (
            <div className="race-fuel-bar" aria-hidden="true">
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
  return [{ value: `P ${race.position}`, caption: race.cars >= 1 ? `of ${race.cars}` : 'position' }];
}

function positionStat(race: LiveRace): Stat[] {
  if (race.position < 1) return [];
  if (race.startPosition === null || race.startPosition < 1) return livePosition(race);
  const lastLap = race.laps.at(-1)?.number ?? race.lap;
  const caption = positionCaption(race.firstRecordedLap ?? lastLap, lastLap, false);
  return [{ value: `${race.startPosition} → ${race.position}`, caption }];
}

function bestStat(race: LiveRace): Stat[] {
  return race.bestLapMs === null ? [] : [{ value: formatTime(race.bestLapMs), caption: `best lap · lap ${race.bestLap}`, tone: 'yellow' }];
}

function statsOf(race: LiveRace): Stat[] {
  switch (race.phase) {
    case 'waiting':
      return [];
    case 'grid':
      return [
        { value: tenths(Math.max(0, race.lapTimeMs)), caption: 'this lap' },
        ...livePosition(race),
        { value: DASH, caption: 'last lap' },
        { value: DASH, caption: 'best lap' },
        ...(race.fuel > 0 ? [{ value: String(Math.round(race.fuel)), caption: 'fuel', fuel: true }] : [])
      ];
    case 'joined':
      return [{ value: tenths(race.lapTimeMs), caption: 'this lap' }, ...livePosition(race)];
    case 'lap':
      return [
        { value: tenths(race.lapTimeMs), caption: 'this lap' },
        ...livePosition(race),
        ...(race.lastLapMs === null ? [] : [{ value: formatTime(race.lastLapMs), caption: 'last lap' }]),
        ...bestStat(race),
        { value: String(Math.round(race.fuel)), caption: race.fuelLapsLeft === null ? 'fuel' : `fuel · about ${race.fuelLapsLeft.toFixed(1)} laps left`, fuel: true }
      ];
    case 'finished':
      if (race.laps.length === 0) return [];
      return [{ value: formatTime(lapsMs(race)), caption: race.firstRecordedLap === 1 ? 'race time' : 'time of the recorded laps' }, ...bestStat(race)];
    case 'stopped':
      if (race.laps.length === 0) return [];
      return [{ value: formatTime(lapsMs(race)), caption: 'time of the recorded laps' }, ...bestStat(race), ...positionStat(race)];
  }
}

function statusDot(recording: boolean, packets: boolean): { colour: 'green' | 'grey' | 'red' | 'yellow'; word: string } {
  if (recording) return packets ? { colour: 'red', word: 'Recording' } : { colour: 'yellow', word: 'Recording \u00b7 no telemetry' };
  return packets ? { colour: 'green', word: 'Telemetry' } : { colour: 'grey', word: 'No telemetry' };
}

function Word({ race }: { race: LiveRace }) {
  switch (race.phase) {
    case 'waiting':
      return <h1 className="race-word dim">WAITING</h1>;
    case 'finished':
      if (race.position < 1) return <h1 className="race-word">FINISHED</h1>;
      return (
        <>
          <p className="race-finished">FINISHED</p>
          <h1 className="race-word yellow rise">
            P {race.position}
            {race.cars >= 1 ? (
              <>
                {' '}
                <span className="race-of">of {race.cars}</span>
              </>
            ) : null}
          </h1>
        </>
      );
    case 'stopped':
      return <h1 className="race-word">RECORDING STOPPED</h1>;
    default:
      return (
        <h1 className={race.phase === 'joined' ? 'race-word dim' : 'race-word yellow'}>
          LAP {Math.max(1, race.lap)} <span className="race-of">of {race.lapsInRace}</span>
        </h1>
      );
  }
}

function Kicker({ race }: { race: LiveRace }) {
  if (race.phase === 'joined') {
    return (
      <p className="race-kicker dim">
        <span className="race-dim-dot" aria-hidden="true" />
        The race runs already
      </p>
    );
  }
  return null;
}

function leadText(race: LiveRace): string[] {
  switch (race.phase) {
    case 'waiting':
      return [
        race.unsupported ? 'This is not a race of 2 or more laps. Only a race by laps can be recorded.' : 'Start a race of 2 or more laps in the game.',
        'The recording starts with the race and stops at the finish. You can look at the TV now.'
      ];
    case 'grid':
      return [];
    case 'joined':
      return ['The recording starts at the next lap line.'];
    case 'lap':
      return [];
    case 'finished':
      return [
        [race.firstRecordedLap === 1 && race.startPosition !== null && race.startPosition >= 1 ? `You started in position ${race.startPosition}.` : null, race.savedRaceId === null ? null : 'The race is in your list.']
          .filter(Boolean)
          .join(' ')
      ].filter(Boolean);
    case 'stopped':
      return [
        race.savedRaceId === null
          ? race.laps.length > 0
            ? 'The race could not be stored. Its raw capture stays on this computer.'
            : 'No complete lap was recorded. Nothing was saved.'
          : `${race.laps.length} of ${race.lapsInRace} laps are in your list. The race is marked as not finished.`
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
  const subline = race.phase !== 'waiting' && race.carName ? race.carName : 'Race recording';
  const button = race.phase === 'waiting' ? 'Cancel' : ended ? 'Close' : 'Stop recording';
  const onButton = ended ? closeStage : () => void stop();

  return (
    <div className={['drive-stage', 'race-stage', motion ? 'motion' : '', showMap ? 'with-map' : ''].filter(Boolean).join(' ')} data-surface="night" data-phase={race.phase}>
      <div className="stage-top">
        <div className="stage-title race-status">
          <p className="race-status-word">
            <span className={`race-dot ${dot.colour}`} aria-hidden="true" />
            {dot.word}
            <span className="visually-hidden">: {telemetry.text}</span>
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
              Open the race
            </button>
            {race.phase === 'finished' ? <span className="race-note">It opens by itself in a moment.</span> : null}
          </div>
        ) : null}
        {race.phase === 'finished' && savedRaceId !== null ? (
          <div className="race-open-bar" aria-hidden="true">
            <i />
          </div>
        ) : null}
        {race.phase === 'stopped' && savedRaceId === null ? (
          <button type="button" className="stage-button" onClick={closeStage} disabled={busy}>
            Back to Races
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
