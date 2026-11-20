import { createContext, useCallback, useContext } from 'react';
import { api, ApiError } from '../api/client.ts';
import { useLiveState } from '../api/live.tsx';
import { TRAINING_MODES } from './current-exercise.ts';

export const TrainingNameContext = createContext<string | null>(null);

export type Training = { on: boolean; running: boolean; exerciseName: string | null; attemptNumber: number | null; stop(): Promise<void> };

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
  const exerciseName = useContext(TrainingNameContext);
  const stop = useCallback(() => stopTraining(), []);
  return { on, running, exerciseName: on ? exerciseName : null, attemptNumber: running ? attemptNumber : null, stop };
}

export type TrainingGate = { notice: string | null; blocked: boolean; label(plain: string): string; before(): Promise<void> };

function attemptRuns(training: Training): string {
  return training.attemptNumber === null ? 'An attempt runs.' : `Attempt ${training.attemptNumber} runs.`;
}

function trainingOf(training: Training): string {
  return training.exerciseName ? `The training of ${training.exerciseName} is on.` : 'The training is on.';
}

export function useTrainingGate(purpose: 'record' | 'delete'): TrainingGate {
  const training = useTraining();
  const notice = !training.on
    ? null
    : training.running
      ? `${attemptRuns(training)} Finish it or stop the training first.`
      : `${trainingOf(training)} ${purpose === 'record' ? 'A recording needs it off.' : 'It stops when you delete.'}`;
  return {
    notice,
    blocked: training.running,
    label: plain => (training.on && !training.running ? (purpose === 'record' ? 'Stop the training and record' : 'Stop the training and delete') : plain),
    before: async () => {
      if (training.on) await training.stop();
    }
  };
}
