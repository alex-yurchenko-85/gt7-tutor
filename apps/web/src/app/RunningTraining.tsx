import { useState } from 'react';
import { errorText } from './resource.ts';
import { useWideLayout } from './layout.ts';
import { Link, paths, useRouter } from './router.tsx';
import { useTraining, type Training } from './use-training.ts';
import { t } from './i18n.ts';

function runningHead(training: Training): string {
  const name = training.exerciseName;
  const number = training.attemptNumber;
  if (number === null) return name ? t('app.training.bar.attempt-runs-named', { name }) : t('app.training.bar.attempt-runs');
  return name ? t('app.training.bar.attempt-number-runs-named', { number, name }) : t('app.training.bar.attempt-number-runs', { number });
}

function barText(training: Training, wide: boolean): string {
  const name = training.exerciseName;
  if (training.running) {
    const head = runningHead(training);
    return wide ? `${head} ${t('app.training.bar.running-hint')}` : head;
  }
  const head = name ? t('app.training.bar.on-named', { name }) : t('app.training.bar.on');
  return wide ? `${head} ${t('app.training.bar.on-hint')}` : head;
}

export function RunningTraining() {
  const training = useTraining();
  const wide = useWideLayout();
  const { route } = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!training.on || (route.name === 'drive' && route.exerciseId === training.exerciseId)) return null;

  const stop = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await training.stop();
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="running-bar" role="status">
      <span className="running-bar-text">{barText(training, wide)}</span>
      <div className="running-bar-actions">
        {training.exerciseId ? (
          <Link to={paths.drive(training.exerciseId)} className="btn ghost inline">
            {t('app.training.bar.open-drive')}
          </Link>
        ) : null}
        <button className="btn inline" type="button" onClick={() => void stop()} disabled={busy}>
          {t('app.training.bar.stop')}
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
