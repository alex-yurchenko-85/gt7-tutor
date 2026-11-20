import { useCallback, useId, useRef, useState } from 'react';
import type { Exercise } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { useLiveConnection, useLiveState } from '../../api/live.tsx';
import { cornerMarks } from '../../charts/corner-marks.ts';
import { MapDialog, cueItems } from '../../charts/MapDialog.tsx';
import { MapPanel } from '../../charts/MapPanel.tsx';
import { TrackMap } from '../../charts/TrackMap.tsx';
import { useDemo } from '../../app/demo.tsx';
import { formatTime } from '../../app/format.ts';
import { useWideLayout } from '../../app/layout.ts';
import { errorText } from '../../app/resource.ts';
import { Link, paths } from '../../app/router.tsx';
import { voiceState } from '../../app/status.ts';
import { CLIPS_TEXT } from '../../voice/VoicePlayer.ts';
import { useVoiceClaim } from '../../voice/use-voice-claim.ts';
import { useExerciseWhere } from '../exercise/use-exercise-where.ts';
import { type ReferenceData, useReferenceData } from './use-reference-data.ts';
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

export type DriveStartProps = { exercise: Exercise; clipsFailed: boolean; onClipsFailed(failed: boolean): void; onArmed(): void };

function StartPanel({ exercise, clipsFailed, onClipsFailed, onArmed }: DriveStartProps) {
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

function ExerciseLine({ exercise, wide }: { exercise: Exercise; wide: boolean }) {
  const where = useExerciseWhere(exercise);
  return (
    <p className="drive-exercise">
      Exercise:
      <Link to={paths.exercise(exercise.id)} className="text-link">
        {exercise.name}
      </Link>
      {wide && where ? <span>· {where}</span> : null}
      <Link to={paths.exercises()} className="text-link">
        Change exercise
      </Link>
    </p>
  );
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

function TimesPanel({ exercise, referenceMs, wide }: { exercise: Exercise; referenceMs: number | null; wide: boolean }) {
  const titleId = useId();
  const medal = exercise.nextMedal;
  if (exercise.bestMs === null && referenceMs === null && medal === null) return null;
  return (
    <section className="panel drive-times" aria-labelledby={titleId}>
      <h2 id={titleId}>Times from the game</h2>
      <div className="times-row">
        {exercise.bestMs !== null ? (
          <div>
            <b>{formatTime(exercise.bestMs)}</b>
            <span>your best</span>
          </div>
        ) : null}
        {referenceMs !== null ? (
          <div className="reference-time">
            <b>{formatTime(referenceMs)}</b>
            <span>reference</span>
          </div>
        ) : null}
        {medal !== null ? (
          <div>
            <b>{seconds(medal.gapMs)}</b>
            <span>{wide ? `to ${medal.medal}, ${formatTime(medal.targetMs)}` : `to ${medal.medal}`}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ReferenceMap({ title, reference }: { title: string; reference: ReferenceData }) {
  const [open, setOpen] = useState(false);
  const { trace, cues, corners } = reference;
  return (
    <MapPanel title={`Reference line, ${Math.round(trace.lengthM)} m`} legend={['reference', 'turn', 'cue', 'muted']} onView={() => setOpen(true)}>
      <TrackMap
        label="Reference line with the voice cues and the turns"
        reference={trace}
        marks={[
          ...cornerMarks(corners),
          ...cues.map((cue, index) => ({ sM: cue.sM, label: String(index + 1), muted: cue.muted, title: `Cue ${index + 1}: ${cue.phrase ?? cue.kind}` }))
        ]}
      />
      <MapDialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        lengthM={trace.lengthM}
        reference={trace}
        corners={corners}
        items={cueItems(cues)}
        listTitle="Voice cues"
        listHint="Select a cue to find it on the line."
      />
    </MapPanel>
  );
}

export function DriveStart(props: DriveStartProps) {
  const { exercise } = props;
  const wide = useWideLayout();
  const reference = useReferenceData(exercise.activeReferenceId);
  const data = reference.data ?? null;
  return (
    <section className="drive-start">
      <h1>Drive</h1>
      <ExerciseLine exercise={exercise} wide={wide} />
      <div className="drive-columns">
        <div className="drive-stack">
          <StartPanel {...props} />
          <TimesPanel exercise={exercise} referenceMs={data?.trace.timeMs ?? null} wide={wide} />
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
