import { createContext, useCallback, useContext } from 'react';
import { api, ApiError } from '../api/client.ts';
import { useLiveState } from '../api/live.tsx';
import { TRAINING_MODES } from './current-exercise.ts';
import { t } from './i18n.ts';

export const TrainingNameContext = createContext<string | null>(null);

export type Training = { on: boolean; running: boolean; exerciseId: string | null; exerciseName: string | null; attemptNumber: number | null; stop(): Promise<void> };

export async function stopTraining(): Promise<void> {
  try {
    await api.disarm();
  } catch (error) {
    if (error instanceof ApiError && error.code === 'not-armed') return;
    throw error;
  }
}

export function useTraining(): Training {
  const on = useLiveState(({ state }) => state !== null && TRAINING_MODES.includes(state.mode));
  const running = useLiveState(({ state }) => state?.mode === 'driving' || state?.mode === 'paused');
  const attemptNumber = useLiveState(({ state }) => state?.attemptNumber ?? null);
  const exerciseId = useLiveState(({ state }) => state?.exerciseId ?? null);
  const exerciseName = useContext(TrainingNameContext);
  const stop = useCallback(() => stopTraining(), []);
  return { on, running, exerciseId: on ? exerciseId : null, exerciseName: on ? exerciseName : null, attemptNumber: running ? attemptNumber : null, stop };
}

export type TrainingGate = { notice: string | null; blocked: boolean; label(plain: string): string; before(): Promise<void> };

function attemptRuns(training: Training): string {
  return training.attemptNumber === null ? t('app.gate.attempt-runs') : t('app.gate.attempt-number-runs', { number: training.attemptNumber });
}

function trainingIsOn(training: Training, purpose: 'record' | 'delete'): string {
  if (purpose === 'record') return training.exerciseName ? t('app.gate.record-named', { name: training.exerciseName }) : t('app.gate.record');
  return training.exerciseName ? t('app.gate.delete-named', { name: training.exerciseName }) : t('app.gate.delete');
}

export function useTrainingGate(purpose: 'record' | 'delete'): TrainingGate {
  const training = useTraining();
  const notice = !training.on
    ? null
    : training.running
      ? attemptRuns(training)
      : trainingIsOn(training, purpose);
  return {
    notice,
    blocked: training.running,
    label: plain => (training.on && !training.running ? (purpose === 'record' ? t('app.gate.stop-and-record') : t('app.gate.stop-and-delete')) : plain),
    before: async () => {
      if (training.on) await training.stop();
    }
  };
}
