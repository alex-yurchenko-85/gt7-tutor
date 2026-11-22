import { useState } from 'react';
import type { LiveRace } from '@gt7/contracts';
import { api } from '../api/client.ts';
import { useLiveState } from '../api/live.tsx';
import { errorText } from './resource.ts';
import { Link, paths, useRouter } from './router.tsx';
import { t } from './i18n.ts';

type BarRace = Pick<LiveRace, 'phase' | 'unsupported' | 'lap' | 'lapsInRace'>;

function barRace(race: LiveRace | null | undefined): BarRace | null {
  if (!race || race.phase === 'finished' || race.phase === 'stopped') return null;
  return { phase: race.phase, unsupported: race.unsupported, lap: race.lap, lapsInRace: race.lapsInRace };
}

function barText(race: BarRace): string {
  switch (race.phase) {
    case 'waiting':
      return race.unsupported ? t('app.race.bar.unsupported') : t('app.race.bar.waiting');
    case 'joined':
      return t('app.race.bar.joined');
    default:
      return t('app.race.bar.lap', { lap: Math.max(1, race.lap), laps: race.lapsInRace });
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
    <div className="running-bar" role="status">
      <span className="running-bar-text">{barText(race)}</span>
      <div className="running-bar-actions">
        <Link to={paths.raceRecord()} className="btn ghost inline">
          {t('app.race.bar.open')}
        </Link>
        <button className="btn inline" type="button" onClick={() => void stop()} disabled={busy}>
          {t('app.race.bar.stop')}
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
