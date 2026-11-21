import { useState } from 'react';
import { api } from '../../api/client.ts';
import { useLiveConnection, useLiveState } from '../../api/live.tsx';
import { useDemo } from '../../app/demo.tsx';
import { errorText } from '../../app/resource.ts';
import { paths, useRouter } from '../../app/router.tsx';
import { stopTraining, useTraining } from '../../app/use-training.ts';
import { t } from '../../app/i18n.ts';

export const ARM_SETTLE_MS = 2000;

const HANDOFF_MS = 15000;

export type StartedTraining = { exerciseId: string; atMs: number; clipsFailed: boolean };

let started: StartedTraining | null = null;

export function startedTraining(exerciseId: string, nowMs: number): StartedTraining | null {
  return started && started.exerciseId === exerciseId && nowMs - started.atMs <= HANDOFF_MS ? started : null;
}

export function forgetStartedTraining(): void {
  started = null;
}

export type DriveStart = {
  busy: boolean;
  problem: string | null;
  asking: boolean;
  trainingName: string | null;
  start(): void;
  confirm(): void;
  cancel(): void;
};

export function useStartDrive(exerciseId: string, referenceId: string | null): DriveStart {
  const { deviceId, player } = useLiveConnection();
  const voiceHere = useLiveState(({ state }) => state !== null && state.voiceDeviceId === deviceId);
  const demo = useDemo() !== null;
  const training = useTraining();
  const { navigate } = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const loadClips = async (): Promise<boolean> => {
    try {
      const id = referenceId ?? (await api.exercise(exerciseId)).activeReferenceId;
      if (id) await player.preload(await api.referenceClips(id));
      return false;
    } catch {
      return true;
    }
  };

  const begin = async (stopFirst: boolean) => {
    setBusy(true);
    setProblem(null);
    try {
      if (stopFirst) await stopTraining();
      const clipsFailed = voiceHere ? await loadClips() : false;
      if (demo) await api.demoAttempt();
      await api.arm({ exerciseId });
      started = { exerciseId, atMs: Date.now(), clipsFailed };
      setAsking(false);
      setBusy(false);
      navigate(paths.drive(exerciseId));
    } catch (error) {
      setProblem(errorText(error));
      setBusy(false);
    }
  };

  return {
    busy,
    problem,
    asking,
    trainingName: training.exerciseName,
    start: () => {
      setProblem(null);
      if (training.on && training.exerciseId === exerciseId) return navigate(paths.drive(exerciseId));
      if (training.running) return setProblem(training.attemptNumber === null ? t('app.gate.attempt-runs') : t('app.gate.attempt-number-runs', { number: training.attemptNumber }));
      if (training.on) return setAsking(true);
      void begin(false);
    },
    confirm: () => void begin(true),
    cancel: () => {
      setAsking(false);
      setProblem(null);
    }
  };
}
