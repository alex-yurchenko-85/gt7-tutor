import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { KPH_PER_MPS, type CornerInfo, type Exercise, type LiveCue, type LiveState, type ReferenceCue, type ReferenceTrace, type TrainingMode } from '@gt7/contracts';
import { api, ApiError } from '../../api/client.ts';
import { useLiveConnection, useLiveState } from '../../api/live.tsx';
import { cornerMarks } from '../../charts/corner-marks.ts';
import { TrackMap } from '../../charts/TrackMap.tsx';
import { currentExercise, liveExerciseId } from '../../app/current-exercise.ts';
import { useDemo } from '../../app/demo.tsx';
import { signedSeconds } from '../../app/format.ts';
import { useImmersive } from '../../app/immersive.tsx';
import { IconButton } from '../../app/IconButton.tsx';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { useSession } from '../../app/session.tsx';
import { StatusDot } from '../../app/Shell.tsx';
import { telemetryStatus, voiceState, voiceStatus, type Status } from '../../app/status.ts';
import { AttemptSummary } from '../attempt-summary/AttemptSummary.tsx';
import { useVoiceClaim } from '../../voice/use-voice-claim.ts';
import { ARMED_MODES, connectionProblem, cueNote, cueWords, guidanceText, nextCueProgress, shownOnDrive, spokenCues } from './cue-display.ts';
import { SeenCues } from './seen-cues.ts';
import { useMissedStart } from './missed-start.ts';
import './drive.css';

const CUE_VISIBLE_MS = 3000;
const ARM_SETTLE_MS = 2000;

type ReferenceData = { trace: ReferenceTrace; corners: CornerInfo[]; spoken: ReferenceCue[] };

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
  const seen = useRef(new SeenCues());
  const now = useTicker(cue !== null, 250);
  if (!cue) return null;
  const first = seen.current.firstSeenMs(cue, Date.now());
  return Math.max(now, Date.now()) - first <= CUE_VISIBLE_MS ? cue : null;
}

function useReferenceData(referenceId: string | null) {
  return useResource<ReferenceData | null>(
    () =>
      referenceId
        ? Promise.all([api.referenceTrace(referenceId), api.referenceCorners(referenceId), api.referenceCues(referenceId)]).then(([trace, corners, cues]) => ({
            trace,
            corners,
            spoken: spokenCues(cues)
          }))
        : Promise.resolve(null),
    [referenceId]
  );
}


function modeLabel(mode: TrainingMode): string {
  return mode === 'guided' ? 'Guided' : 'Baseline';
}

type CueContent = { word: ReactNode; note: string | null; tone: 'cue' | 'armed' | 'idle' };

function cueContent(state: LiveState, mode: TrainingMode, problem: string | null, fresh: LiveCue | null, reference: ReferenceData | null): CueContent {
  const idle = (text: string): CueContent => ({ word: text, note: null, tone: 'idle' });
  if (problem) return idle('');
  if (state.mode === 'armed') return { word: 'READY', note: 'Waiting for the start', tone: 'armed' };
  if (mode === 'baseline') return idle('Recording without voice');
  if (state.mode === 'paused') return idle('Paused. Cues stop until you continue.');
  if (state.mode === 'finished') return idle('Finished.');
  const guidance = guidanceText(state.guidance);
  if (guidance) return idle(guidance);
  if (!fresh || !shownOnDrive(fresh)) return idle('');
  const words = cueWords(fresh);
  return {
    word: (
      <>
        <span className="cue-words">{words.words}</span>
        {words.number ? <span className="cue-number">{words.number}</span> : null}
      </>
    ),
    note: reference ? cueNote(fresh, reference.spoken, reference.corners) : null,
    tone: 'cue'
  };
}

function CueArea({ state, mode, problem, reference }: { state: LiveState; mode: TrainingMode; problem: string | null; reference: ReferenceData | null }) {
  const fresh = useFreshCue(shownOnDrive(state.lastCue) ? state.lastCue : null);
  const content = cueContent(state, mode, problem, fresh, reference);
  return (
    <div className={`cue ${content.tone}`} role="status" aria-label="Current cue" aria-live="assertive">
      <div className="cue-word">{content.word}</div>
      {content.note ? <p className="cue-note">{content.note}</p> : null}
    </div>
  );
}

function NextCue({ state, mode, problem, reference }: { state: LiveState; mode: TrainingMode; problem: string | null; reference: ReferenceData | null }) {
  let text = '';
  let distance = '';
  let progress = 0;
  if (mode === 'guided' && !problem) {
    const first = reference?.spoken[0];
    if (state.mode === 'armed' && first) {
      text = `First cue: ${first.phrase}`;
      distance = 'after the start';
    } else if (state.nextCue && state.sM !== null) {
      text = `Next: ${state.nextCue.text}`;
      distance = `in ${Math.round(state.nextCue.inM)} m`;
      progress = reference ? nextCueProgress(state.sM, state.nextCue.inM, reference.spoken) : 0;
    }
  }
  return (
    <div className="next">
      <div className="next-line">
        <span>{text}</span>
        <span>{distance}</span>
      </div>
      <div className="next-bar" aria-hidden="true">
        <span style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
    </div>
  );
}

function LiveNumbers({ state, live, reference }: { state: LiveState; live: boolean; reference: ReferenceData | null }) {
  return (
    <div className="live-numbers">
      <div>
        <b>{!live || state.speedMps === null ? '–' : Math.round(state.speedMps * KPH_PER_MPS)}</b>km/h
      </div>
      <div>
        <b>{!live || state.sM === null ? '–' : Math.round(state.sM)}</b>
        {reference ? `m of ${Math.round(reference.trace.lengthM)}` : 'm from the start'}
      </div>
      <div className="gap">
        <b>{!live || state.gapMs === null ? '–' : signedSeconds(state.gapMs, 1)}</b>s to reference
      </div>
    </div>
  );
}

function StageStatus({ status, label }: { status: Status; label: string }) {
  return (
    <span className="stage-status">
      <StatusDot status={status} />
      {label}
      <span className="visually-hidden">: {status.text}</span>
    </span>
  );
}

function MissedStart({ onDismiss }: { onDismiss(): void }) {
  const titleId = useId();
  return (
    <div className="missed-start" role="alert" aria-labelledby={titleId}>
      <h2 id={titleId}>The game timer did not start</h2>
      <p>The car has moved for 10 s, but the game timer has not started. Restart the exercise in the game. The attempt starts with the game timer.</p>
      <div className="missed-actions">
        <button type="button" className="stage-button primary" onClick={onDismiss}>
          OK
        </button>
      </div>
    </div>
  );
}

type StageProps = { state: LiveState; mode: TrainingMode; exercise: Exercise; finishedAttempt: string | null; onDriveAgain(): void; onStop(): void };

function Stage({ state, mode, exercise, finishedAttempt, onDriveAgain, onStop }: StageProps) {
  const { deviceId } = useLiveConnection();
  const { connected } = useLiveState(snapshot => snapshot);
  const demo = useDemo() !== null;
  const telemetry = telemetryStatus(state, connected, demo);
  const voice = voiceStatus(state, deviceId);
  const problem = connectionProblem(state, connected, demo);
  const live = problem === null;
  const reference = useReferenceData(exercise.activeReferenceId).data ?? null;
  const missedStart = useMissedStart(state);
  const marks = useMemo(() => (reference ? cornerMarks(reference.corners) : []), [reference]);

  return (
    <div className="drive-stage" data-surface="night">
      <div className="stage-top">
        <div className="stage-title">
          <p>{`${modeLabel(mode)} attempt${state.attemptNumber === null ? '' : ` ${state.attemptNumber}`} · ${exercise.name}`}</p>
          <div className="stage-row">
            <StageStatus status={telemetry} label="Telemetry" />
            {mode === 'baseline' ? <span className="stage-status">No voice</span> : <StageStatus status={voice} label="Voice" />}
          </div>
        </div>
        <button type="button" className="stage-button" onClick={onStop}>
          Stop
        </button>
      </div>
      <div className="stage-left">
        {finishedAttempt ? (
          <div className="stage-summary">
            <AttemptSummary key={finishedAttempt} attemptId={finishedAttempt} onDriveAgain={onDriveAgain} />
          </div>
        ) : (
          <>
            <CueArea state={state} mode={mode} problem={problem} reference={reference} />
            <NextCue state={state} mode={mode} problem={problem} reference={reference} />
            <LiveNumbers state={state} live={live} reference={reference} />
          </>
        )}
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
        {missedStart.missed ? <MissedStart onDismiss={missedStart.dismiss} /> : null}
      </div>
      {reference ? (
        <div className="stage-map">
          <TrackMap
            label="Your position on the reference line, with the turns"
            reference={reference.trace}
            marks={marks}
            cursorSM={live ? state.sM : null}
            dark
          />
        </div>
      ) : null}
    </div>
  );
}

function useReferenceClips(referenceId: string | null) {
  const { player } = useLiveConnection();
  const loading = useRef<{ referenceId: string; done: Promise<number> } | null>(null);
  return useCallback((): Promise<number> => {
    if (!referenceId) return Promise.resolve(0);
    if (loading.current?.referenceId !== referenceId) {
      const done = Promise.all([api.referenceCues(referenceId), api.referenceClips(referenceId)]).then(async ([cues, clips]) => {
        await player.preload(clips);
        return spokenCues(cues).length;
      });
      done.catch(() => {
        if (loading.current?.done === done) loading.current = null;
      });
      loading.current = { referenceId, done };
    }
    return loading.current.done;
  }, [referenceId, player]);
}

function VoiceBlock({ ensureClips }: { ensureClips(): Promise<number> }) {
  const { player, deviceId } = useLiveConnection();
  const { state } = useLiveState(snapshot => snapshot);
  const voice = useVoiceClaim();
  const [loaded, setLoaded] = useState<number | null>(null);
  const [testProblem, setTestProblem] = useState<string | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!voice.ready) return;
    let active = true;
    ensureClips().then(
      count => {
        if (active) setLoaded(count);
      },
      () => undefined
    );
    return () => {
      active = false;
    };
  }, [voice.ready, ensureClips]);

  const test = async () => {
    setTestProblem(null);
    try {
      await player.test();
    } catch (error) {
      setTestProblem(`The test did not play: ${errorText(error)}`);
    }
  };

  if (voice.ready) {
    return (
      <div className="voice-ready">
        <StatusDot status={{ tone: 'on', text: '' }} />
        <div>
          <p className="voice-ready-title">This device plays the voice</p>
          <p className="sub">
            {loaded === null ? 'Loading the cues…' : `${loaded} cues loaded.`}
          </p>
          {testProblem ? <p className="error">{testProblem}</p> : null}
        </div>
        <IconButton icon="speaker" label="Test" onClick={() => void test()} />
      </div>
    );
  }

  const elsewhere = voiceState(state, deviceId) === 'elsewhere';
  return (
    <div className="notice bad voice-off" aria-labelledby={titleId} role="group">
      <h2 id={titleId}>{elsewhere ? 'The voice is on another device' : 'The voice is off'}</h2>
      <p>{`${elsewhere ? 'That device plays the cues. ' : ''}This device can play the cues. A phone must stay unlocked during the attempt.`}</p>
      <button className="btn" type="button" onClick={() => void voice.claim()} disabled={voice.busy}>
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

function ArmPanel({ exercise, onArmed }: { exercise: Exercise; onArmed(mode: TrainingMode): void }) {
  const { search } = useRouter();
  const { deviceId } = useLiveConnection();
  const { state } = useLiveState(snapshot => snapshot);
  const demo = useDemo() !== null;
  const [chosenMode, setMode] = useState<TrainingMode>(search.get('mode') === 'baseline' ? 'baseline' : 'guided');
  const mode: TrainingMode = demo ? 'guided' : chosenMode;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ensure = useReferenceClips(exercise.activeReferenceId);
  const voiceReady = state?.voiceDeviceId !== null && state?.voiceDeviceId !== undefined && state.voiceReady;
  const voiceHere = state?.voiceDeviceId === deviceId;

  const arm = async (confirmNoVoice: boolean) => {
    if (mode === 'guided' && !voiceReady && !confirmNoVoice) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      if (mode === 'guided' && voiceHere) await ensure();
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
      {mode === 'guided' ? <VoiceBlock ensureClips={ensure} /> : null}
      <p className="sub">
        {demo
          ? 'The demo replays a recorded guided attempt in real time. It takes about one minute, and the voice plays the cues on the voice device.'
          : 'After you start, open the exercise in GT7 and drive. GT7 Tutor finds the start and the finish by itself.'}
      </p>
      {confirming ? (
        <div className="notice bad" role="alert">
          <p>No device plays the voice. If you start now, the attempt is recorded and no cue is played.</p>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn inline" type="button" onClick={() => void arm(true)} disabled={busy}>
              {demo ? 'Play without voice' : 'Start without voice'}
            </button>
            <Link to={paths.setup('voice')} className="btn inline ghost">
              Set up voice
            </Link>
          </div>
        </div>
      ) : (
        <button className="btn arm-button" type="button" onClick={() => void arm(false)} disabled={busy}>
          {demo ? 'Play a demo attempt' : `Start a ${mode} attempt`}
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
  const { state } = useLiveState(snapshot => snapshot);
  const [justArmed, setJustArmed] = useState<TrainingMode | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const liveArmed = state !== null && ARMED_MODES.includes(state.mode) && state.exerciseId === exercise.id;
  const armed = liveArmed || justArmed !== null;
  const mode: TrainingMode = (liveArmed ? state.trainingMode : null) ?? justArmed ?? 'guided';
  useImmersive(armed);

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

  const [earlierAttempt, setEarlierAttempt] = useState<string | null | undefined>(undefined);
  const running = state !== null && (state.mode === 'armed' || state.mode === 'driving' || state.mode === 'paused');
  if (running && earlierAttempt !== state.lastAttemptId) setEarlierAttempt(state.lastAttemptId);
  const newAttempt = state?.mode === 'finished' && state.lastAttemptId && state.lastAttemptId !== earlierAttempt ? state.lastAttemptId : null;
  const finishedAttempt = newAttempt !== dismissed ? newAttempt : null;
  const errorLine = problem ? (
    <p className="error" role="alert">
      {problem}
    </p>
  ) : null;

  if (armed) {
    return (
      <>
        {errorLine}
        {state ? (
          <Stage
            state={state}
            mode={mode}
            exercise={exercise}
            finishedAttempt={finishedAttempt}
            onDriveAgain={() => finishedAttempt && setDismissed(finishedAttempt)}
            onStop={() => void disarm()}
          />
        ) : (
          <p className="sub">Connecting to GT7 Tutor…</p>
        )}
      </>
    );
  }
  return (
    <>
      <div className="drive-head">
        <p className="sub">{exercise.name}</p>
        <h1>Drive</h1>
      </div>
      {errorLine}
      <ArmPanel exercise={exercise} onArmed={onArmed} />
    </>
  );
}

export function DriveView() {
  const { user } = useSession();
  const liveId = useLiveState(({ state }) => liveExerciseId(state));
  const exercises = useResource(() => api.exercises(), []);
  if (exercises.error) return <p className="error">{errorText(exercises.error)}</p>;
  if (!exercises.data) return <h1>Drive</h1>;
  const exercise = currentExercise(exercises.data, user.id, liveId);
  if (!exercise || !exercise.activeReferenceId) {
    return (
      <section>
        <h1>Drive</h1>
        <p className="lede">{exercise ? 'This exercise has no reference yet. Record it first.' : 'Select an exercise first.'}</p>
        <Link to={exercise ? paths.record(exercise.id) : paths.addExercise()} className="btn inline">
          {exercise ? 'Record the reference' : 'Select an exercise'}
        </Link>
      </section>
    );
  }
  return <DriveExercise key={exercise.id} exercise={exercise} />;
}
