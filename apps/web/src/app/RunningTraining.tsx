import { useState } from 'react';
import { errorText } from './resource.ts';
import { useWideLayout } from './layout.ts';
import { Link, paths, useRouter } from './router.tsx';
import { useTraining, type Training } from './use-training.ts';

function barText(training: Training, wide: boolean): string {
  const name = training.exerciseName ? `: ${training.exerciseName}` : '';
  if (training.running) {
    const head = training.attemptNumber === null ? `An attempt runs${name}.` : `Attempt ${training.attemptNumber} runs${name}.`;
    return wide ? `${head} Stop training ends it without a time.` : head;
  }
  const head = `The training is on${name}.`;
  return wide ? `${head} Restart the exercise in GT7 to drive the next attempt.` : head;
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
    <div className="running-bar" role="status" aria-label="Training">
      <span className="running-bar-text">{barText(training, wide)}</span>
      <div className="running-bar-actions">
        {training.exerciseId ? (
          <Link to={paths.drive(training.exerciseId)} className="btn ghost inline">
            Open Drive
          </Link>
        ) : null}
        <button className="btn inline" type="button" onClick={() => void stop()} disabled={busy}>
          Stop training
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
