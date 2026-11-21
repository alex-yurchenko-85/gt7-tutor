import { useState } from 'react';
import type { LiveRace } from '@gt7/contracts';
import { api } from '../api/client.ts';
import { useLiveState } from '../api/live.tsx';
import { errorText } from './resource.ts';
import { Link, paths, useRouter } from './router.tsx';

type BarRace = Pick<LiveRace, 'phase' | 'unsupported' | 'lap' | 'lapsInRace'>;

function barRace(race: LiveRace | null | undefined): BarRace | null {
  if (!race || race.phase === 'finished' || race.phase === 'stopped') return null;
  return { phase: race.phase, unsupported: race.unsupported, lap: race.lap, lapsInRace: race.lapsInRace };
}

function barText(race: BarRace): string {
  switch (race.phase) {
    case 'waiting':
      return race.unsupported ? 'This is not a race of 2 or more laps. Only a race by laps can be recorded.' : 'Waiting for the race. Start a race by laps in the game.';
    case 'joined':
      return 'Recording a race · it starts at the next lap line';
    default:
      return `Recording a race · lap ${Math.max(1, race.lap)} of ${race.lapsInRace}`;
  }
}

export function RunningRace() {
  const race = useLiveState(({ state }) => barRace(state?.race));
  const { route } = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!race || route.name === 'race-record') return null;

  const stop = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api.stopRace();
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="running-bar" role="status" aria-label="Race recording">
      <span className="running-bar-text">{barText(race)}</span>
      <div className="running-bar-actions">
        <Link to={paths.raceRecord()} className="btn ghost inline">
          Open the recording
        </Link>
        <button className="btn inline" type="button" onClick={() => void stop()} disabled={busy}>
          Stop recording
        </button>
      </div>
      {problem ? (
        <span className="error" role="alert">
          {problem}
        </span>
      ) : null}
    </div>
  );
}
