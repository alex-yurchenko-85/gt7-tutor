import { useCallback, useRef, useState } from 'react';
import type { Exercise } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { useLiveConnection, useLiveState } from '../../api/live.tsx';
import { useDemo } from '../../app/demo.tsx';
import { formatSeconds, formatTime } from '../../app/format.ts';
import { useWideLayout } from '../../app/layout.ts';
import { errorText, type Resource } from '../../app/resource.ts';
import { Link, paths } from '../../app/router.tsx';
import { voiceState } from '../../app/status.ts';
import { CLIPS_TEXT } from '../../voice/VoicePlayer.ts';
import { useVoiceClaim } from '../../voice/use-voice-claim.ts';
import { ReferenceMap } from '../exercise/ReferenceMap.tsx';
import { TimesPanel } from '../exercise/TimesPanel.tsx';
import { useExerciseWhere } from '../exercise/use-exercise-where.ts';
import type { ReferenceData } from './use-reference-data.ts';
import '../exercise/overview.css';
import './drive.css';

const HINT = 'Select Start an attempt. Then open the exercise in GT7 and drive. GT7 Tutor finds the start and the finish.';
const DEMO_HINT = 'The demo replays a recorded attempt in real time. It takes about 40 s. This screen shows the cues, and the voice device also says them.';

function useReferenceClips(referenceId: string | null) {
  const { player } = useLiveConnection();
  const loading = useRef<{ referenceId: string; done: Promise<void> } | null>(null);
  return useCallback((): Promise<void> => {
    if (!referenceId) return Promise.resolve();
    if (loading.current?.referenceId !== referenceId) {
      const done = api.referenceClips(referenceId).then(clips => player.preload(clips));
      done.catch(() => {
        if (loading.current?.done === done) loading.current = null;
      });
      loading.current = { referenceId, done };
    }
    return loading.current.done;
  }, [referenceId, player]);
}

function VoiceNotice() {
  const { deviceId } = useLiveConnection();
  const { state } = useLiveState(snapshot => snapshot);
  const voice = useVoiceClaim();
  if (!state) return null;
  const where = voiceState(state, deviceId);
  if (where === 'here' || where === 'elsewhere') return null;
  return (
    <div className="notice voice-notice" role="group" aria-label="Voice">
      <p>
        <b>No device plays the voice.</b> The screen still shows the cues.
      </p>
      <button className="btn ghost inline" type="button" onClick={() => void voice.claim()} disabled={voice.busy}>
        Use this device for voice
      </button>
      {voice.problem ? (
        <p className="error" role="alert">
          {voice.problem}
        </p>
      ) : null}
    </div>
  );
}

type StartPanelProps = { exercise: Exercise; clipsFailed: boolean; onClipsFailed(failed: boolean): void; onArmed(): void };

export type DriveStartProps = StartPanelProps & { reference: Resource<ReferenceData | null> };

function StartPanel({ exercise, clipsFailed, onClipsFailed, onArmed }: StartPanelProps) {
  const { deviceId } = useLiveConnection();
  const { state } = useLiveState(snapshot => snapshot);
  const demo = useDemo() !== null;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ensure = useReferenceClips(exercise.activeReferenceId);
  const loadClips = useCallback(
    () =>
      ensure().then(
        () => onClipsFailed(false),
        (error: unknown) => {
          onClipsFailed(true);
          throw error;
        }
      ),
    [ensure, onClipsFailed]
  );
  const voiceHere = state?.voiceDeviceId === deviceId;

  const arm = async () => {
    setBusy(true);
    setProblem(null);
    try {
      if (voiceHere) await loadClips().catch(() => undefined);
      if (demo) await api.demoAttempt();
      await api.arm({ exerciseId: exercise.id });
      onArmed();
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel arm-panel">
      <VoiceNotice />
      <p className="sub">{demo ? DEMO_HINT : HINT}</p>
      <button className="btn arm-button" type="button" onClick={() => void arm()} disabled={busy}>
        {demo ? 'Play a demo attempt' : 'Start an attempt'}
      </button>
      {clipsFailed && voiceHere ? (
        <p className="error" role="alert">
          {CLIPS_TEXT}
        </p>
      ) : null}
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="text-links">
        <Link to={paths.cues(exercise.id)} className="text-link">
          Hear the cues first
        </Link>
      </div>
    </div>
  );
}

function ExerciseWhere({ exercise }: { exercise: Exercise }) {
  const where = useExerciseWhere(exercise);
  return where ? <span>· {where}</span> : null;
}

function ExerciseLine({ exercise, wide }: { exercise: Exercise; wide: boolean }) {
  return (
    <p className="drive-exercise">
      Exercise:
      <Link to={paths.exercise(exercise.id)} className="text-link">
        {exercise.name}
      </Link>
      {wide ? <ExerciseWhere exercise={exercise} /> : null}
      <Link to={paths.exercises()} className="text-link">
        Change exercise
      </Link>
    </p>
  );
}

function MedalGap({ medal, wide }: { medal: NonNullable<Exercise['nextMedal']>; wide: boolean }) {
  return (
    <div>
      <b>{formatSeconds(medal.gapMs)}</b>
      <span>{wide ? `to ${medal.medal}, ${formatTime(medal.targetMs)}` : `to ${medal.medal}`}</span>
    </div>
  );
}

export function DriveStart({ reference, ...props }: DriveStartProps) {
  const { exercise } = props;
  const wide = useWideLayout();
  const data = reference.data ?? null;
  return (
    <section className="drive-start">
      <h1>Drive</h1>
      <ExerciseLine exercise={exercise} wide={wide} />
      <div className="drive-columns">
        <div className="drive-stack">
          <StartPanel {...props} />
          <TimesPanel bestMs={exercise.bestMs} referenceMs={data?.trace.timeMs ?? null}>
            {exercise.nextMedal ? <MedalGap medal={exercise.nextMedal} wide={wide} /> : null}
          </TimesPanel>
        </div>
        {data ? (
          <ReferenceMap title={exercise.name} reference={data} />
        ) : reference.error ? (
          <p className="error">{errorText(reference.error)}</p>
        ) : null}
      </div>
    </section>
  );
}
