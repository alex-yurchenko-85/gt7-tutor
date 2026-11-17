import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Exercise, LiveCue, LiveState, TrainingMode } from '@gt7/contracts';
import { api, ApiError } from '../../api/client.ts';
import { useLive } from '../../api/live.tsx';
import { cornerMarks } from '../../charts/corner-marks.ts';
import { TrackMap } from '../../charts/TrackMap.tsx';
import { currentExercise } from '../../app/current-exercise.ts';
import { useDemo } from '../../app/demo.tsx';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { useSession } from '../../app/session.tsx';
import { StatusDot } from '../../app/Shell.tsx';
import { telemetryStatus, voiceStatus } from '../../app/status.ts';
import { AttemptSummary } from '../attempt-summary/AttemptSummary.tsx';
import { clipsForCues } from '../../voice/clips.ts';
import { ARMED_MODES, connectionProblem, cueWords, guidanceText, shownOnDrive } from './cue-display.ts';
import './drive.css';

const CUE_VISIBLE_MS = 3000;
const ARM_SETTLE_MS = 2000;

function useTicker(running: boolean, everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [running, everyMs]);
  return now;
}

function useFreshCue(cue: LiveCue | null): LiveCue | null {
  const seen = useRef(new Map<string, number>());
  const now = useTicker(cue !== null, 250);
  if (!cue) return null;
  if (!seen.current.has(cue.id)) seen.current.set(cue.id, Date.now());
  return Math.max(now, Date.now()) - seen.current.get(cue.id)! <= CUE_VISIBLE_MS ? cue : null;
}

function CueArea({ state, mode, socketConnected }: { state: LiveState; mode: TrainingMode; socketConnected: boolean }) {
  const fresh = useFreshCue(shownOnDrive(state.lastCue) ? state.lastCue : null);
  const demo = useDemo() !== null;
  const problem = connectionProblem(state, socketConnected, demo);
  const guidance = guidanceText(state.guidance);
  let content: ReactNode;
  let idle = true;
  if (problem) content = '';
  else if (mode === 'baseline') content = 'Recording without voice';
  else if (state.mode === 'paused') content = 'Paused. Cues stop until you continue.';
  else if (state.mode === 'armed') content = 'Armed. Start the exercise in the game.';
  else if (state.mode === 'finished') content = 'Finished.';
  else if (guidance) content = guidance;
  else if (fresh && shownOnDrive(fresh)) {
    const words = cueWords(fresh);
    idle = false;
    content = (
      <>
        <span className="cue-words">{words.words}</span>
        {words.number ? <span className="cue-number">{words.number}</span> : null}
      </>
    );
  } else content = '';
  return (
    <div className={`cue${idle ? ' idle' : ''}`} role="status" aria-label="Current cue" aria-live="assertive">
      {content}
    </div>
  );
}

function Stage({ state, mode, exercise }: { state: LiveState; mode: TrainingMode; exercise: Exercise }) {
  const { connected, deviceId } = useLive();
  const demo = useDemo() !== null;
  const telemetry = telemetryStatus(state, connected, demo);
  const voice = voiceStatus(state, deviceId);
  const problem = connectionProblem(state, connected, demo);
  const live = problem === null;
  const trace = useResource(
    () =>
      exercise.activeReferenceId
        ? Promise.all([api.referenceTrace(exercise.activeReferenceId), api.referenceCorners(exercise.activeReferenceId)])
        : Promise.resolve(null),
    [exercise.activeReferenceId]
  );
  const [actionProblem, setActionProblem] = useState<string | null>(null);
  const manual = async (action: 'start' | 'finish' | 'abort') => {
    setActionProblem(null);
    try {
      await api.manual(action);
    } catch (error) {
      setActionProblem(errorText(error));
    }
  };
  return (
    <div className="drive-stage" data-surface="night">
      <div className="stage-left">
        <div className="stage-row">
          <span>
            <StatusDot status={voice} />
            {mode === 'baseline' ? 'No voice in a baseline attempt' : voice.text}
          </span>
          <span>
            <StatusDot status={telemetry} />
            {telemetry.text}
          </span>
        </div>
        <CueArea state={state} mode={mode} socketConnected={connected} />
        {problem ? (
          <p className="stage-alert" role="alert">
            {problem}
          </p>
        ) : null}
        {!state.recordingComplete ? (
          <p className="stage-alert" role="alert">
            The recording is incomplete{state.storageError ? `: ${state.storageError}` : ''}. Coaching continues.
          </p>
        ) : null}
        <div className="live-numbers">
          <div>
            <b>{!live || state.speedKph === null ? '–' : Math.round(state.speedKph)}</b>km/h
          </div>
          <div>
            <b>{!live || state.sM === null ? '–' : Math.round(state.sM)}</b>m from the start
          </div>
          <div>
            <b>{state.attemptNumber ?? '–'}</b>attempt
          </div>
        </div>
        <div className="next">{state.nextCue && mode === 'guided' && !problem ? `Next in ${Math.round(state.nextCue.inM)} m: ${state.nextCue.text}` : ' '}</div>
        <div className="stage-controls">
          <button type="button" onClick={() => void manual('start')}>
            Start now
          </button>
          <button type="button" onClick={() => void manual('finish')}>
            Finish now
          </button>
          <button type="button" onClick={() => void manual('abort')}>
            Abort attempt
          </button>
        </div>
        {actionProblem ? <p className="stage-alert">{actionProblem}</p> : null}
      </div>
      {trace.data ? (
        <div className="stage-map">
          <TrackMap
            label="Your position on the reference line, with the turns"
            reference={trace.data[0]}
            marks={cornerMarks(trace.data[1])}
            cursorSM={live ? state.sM : null}
            dark
          />
        </div>
      ) : null}
    </div>
  );
}

function ArmPanel({ exercise, onArmed }: { exercise: Exercise; onArmed(mode: TrainingMode): void }) {
  const { search } = useRouter();
  const { state, player, deviceId } = useLive();
  const demo = useDemo() !== null;
  const [chosenMode, setMode] = useState<TrainingMode>(search.get('mode') === 'baseline' ? 'baseline' : 'guided');
  const mode: TrainingMode = demo ? 'guided' : chosenMode;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const voice = voiceStatus(state, deviceId);
  const voiceReady = state?.voiceDeviceId !== null && state?.voiceDeviceId !== undefined && state.voiceReady;
  const voiceHere = state?.voiceDeviceId === deviceId;

  const preloadClips = async () => {
    if (!exercise.activeReferenceId) return;
    const [cues, corners] = await Promise.all([api.referenceCues(exercise.activeReferenceId), api.referenceCorners(exercise.activeReferenceId)]);
    await player.preload(clipsForCues(cues, corners.length));
  };

  const arm = async (confirmNoVoice: boolean) => {
    if (mode === 'guided' && !voiceReady && !confirmNoVoice) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      if (mode === 'guided' && voiceHere) await preloadClips();
      if (demo) await api.demoAttempt();
      await api.arm({ exerciseId: exercise.id, mode, ...(confirmNoVoice ? { confirmNoVoice: true } : {}) });
      setConfirming(false);
      onArmed(mode);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'voice-not-ready') setConfirming(true);
      else setProblem(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel arm-panel">
      {demo ? null : (
      <fieldset className="plain">
        <legend className="label">Attempt type</legend>
        <div className="segmented">
          <label>
            <input type="radio" name="training-mode" checked={mode === 'baseline'} onChange={() => setMode('baseline')} />
            Baseline, no voice
          </label>
          <label>
            <input type="radio" name="training-mode" checked={mode === 'guided'} onChange={() => setMode('guided')} />
            Guided, with voice
          </label>
        </div>
      </fieldset>
      )}
      <p className="voice-line">
        <StatusDot status={voice} />
        {voice.text}
        {mode === 'guided' && !voiceReady ? (
          <>
            {' '}
            <Link to={paths.setup()}>Set up voice</Link>
          </>
        ) : null}
      </p>
      <p className="sub">
        {demo
          ? 'The demo replays a recorded guided attempt in real time. It takes about one minute, and the voice plays the cues on the voice device.'
          : 'After you arm, open the exercise in GT7 and drive. GT7 Tutor finds the start and the finish by itself.'}
      </p>
      {confirming ? (
        <div className="notice bad" role="alert">
          <p>No device plays the voice. If you arm now, the attempt is recorded and no cue is played.</p>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn inline" type="button" onClick={() => void arm(true)} disabled={busy}>
              {demo ? 'Play without voice' : 'Arm without voice'}
            </button>
            <Link to={paths.setup()} className="btn inline ghost">
              Set up voice
            </Link>
          </div>
        </div>
      ) : (
        <button className="btn" type="button" onClick={() => void arm(false)} disabled={busy}>
          {demo ? 'Play a demo attempt' : `Arm a ${mode} attempt`}
        </button>
      )}
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

function DriveExercise({ exercise }: { exercise: Exercise }) {
  const { state } = useLive();
  const [justArmed, setJustArmed] = useState<TrainingMode | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const liveArmed = state !== null && ARMED_MODES.includes(state.mode) && state.exerciseId === exercise.id;
  const armed = liveArmed || justArmed !== null;
  const mode: TrainingMode = (liveArmed ? state.trainingMode : null) ?? justArmed ?? 'guided';

  const armedAt = useRef(0);
  useEffect(() => {
    if (justArmed === null) return;
    if (liveArmed || (state?.mode === 'idle' && Date.now() - armedAt.current > ARM_SETTLE_MS)) setJustArmed(null);
  }, [liveArmed, state?.mode, state?.seq, justArmed]);

  const onArmed = (chosen: TrainingMode) => {
    armedAt.current = Date.now();
    setJustArmed(chosen);
  };
  const disarm = async () => {
    setProblem(null);
    try {
      await api.disarm();
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'not-armed')) setProblem(errorText(error));
    }
    setJustArmed(null);
  };

  const finishedAttempt = state?.mode === 'finished' && state.lastAttemptId && state.lastAttemptId !== dismissed ? state.lastAttemptId : null;
  return (
    <>
      <div className="drive-head">
        <div>
          <p className="sub">{exercise.family}</p>
          <h1>Drive</h1>
          <p className="sub">{exercise.name}</p>
        </div>
        {armed ? (
          <button className="btn inline ghost" type="button" onClick={() => void disarm()}>
            Stop training
          </button>
        ) : null}
      </div>
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
      {finishedAttempt ? <AttemptSummary key={finishedAttempt} attemptId={finishedAttempt} onDriveAgain={() => setDismissed(finishedAttempt)} /> : null}
      {armed && state ? <Stage state={state} mode={mode} exercise={exercise} /> : null}
      {armed && !state ? <p className="sub">Connecting to GT7 Tutor…</p> : null}
      {!armed ? <ArmPanel exercise={exercise} onArmed={onArmed} /> : null}
    </>
  );
}

export function DriveView() {
  const { user } = useSession();
  const exercises = useResource(() => api.exercises(), []);
  if (exercises.error) return <p className="error">{errorText(exercises.error)}</p>;
  if (!exercises.data) return <h1>Drive</h1>;
  const exercise = currentExercise(exercises.data, user.id);
  if (!exercise || !exercise.activeReferenceId) {
    return (
      <section>
        <h1>Drive</h1>
        <p className="lede">{exercise ? 'This exercise has no reference yet. Record it first.' : 'Select an exercise first.'}</p>
        <Link to={exercise ? paths.record(exercise.id) : paths.catalogue()} className="btn inline">
          {exercise ? 'Record the reference' : 'Select an exercise'}
        </Link>
      </section>
    );
  }
  return <DriveExercise exercise={exercise} />;
}
