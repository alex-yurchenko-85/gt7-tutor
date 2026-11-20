import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { KPH_PER_MPS, type CornerInfo, type Exercise, type LiveCue, type LiveState, type ReferenceCue, type ReferenceTrace } from '@gt7/contracts';
import { api, ApiError } from '../../api/client.ts';
import { useLiveConnection, useLiveState } from '../../api/live.tsx';
import { cornerMarks } from '../../charts/corner-marks.ts';
import { TrackMap } from '../../charts/TrackMap.tsx';
import { currentExercise, liveExerciseId, TRAINING_MODES } from '../../app/current-exercise.ts';
import { useDemo } from '../../app/demo.tsx';
import { signedSeconds } from '../../app/format.ts';
import { counted } from '../../app/plural.ts';
import { useImmersive } from '../../app/immersive.tsx';
import { IconButton } from '../../app/IconButton.tsx';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths } from '../../app/router.tsx';
import { useSession } from '../../app/session.tsx';
import { StatusDot } from '../../app/Shell.tsx';
import { telemetryStatus, voiceState, voiceStatus, type Status } from '../../app/status.ts';
import { AttemptSummary } from '../attempt-summary/AttemptSummary.tsx';
import { CLIPS_TEXT } from '../../voice/VoicePlayer.ts';
import { useVoiceClaim } from '../../voice/use-voice-claim.ts';
import { connectionProblem, cueNote, cueWords, guidanceText, nextCueProgress, shownOnDrive, spokenCues } from './cue-display.ts';
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


type CueContent = { word: ReactNode; note: string | null; tone: 'cue' | 'armed' | 'idle' };

function cueContent(state: LiveState, problem: string | null, fresh: LiveCue | null, reference: ReferenceData | null): CueContent {
  const idle = (text: string): CueContent => ({ word: text, note: null, tone: 'idle' });
  if (problem) return idle('');
  if (state.mode === 'armed') return { word: 'READY', note: 'Waiting for the start', tone: 'armed' };
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

function CueArea({ state, problem, reference }: { state: LiveState; problem: string | null; reference: ReferenceData | null }) {
  const fresh = useFreshCue(shownOnDrive(state.lastCue) ? state.lastCue : null);
  const content = cueContent(state, problem, fresh, reference);
  return (
    <div className={`cue ${content.tone}`} role="status" aria-label="Current cue" aria-live="assertive">
      <div className="cue-word">{content.word}</div>
      {content.note ? <p className="cue-note">{content.note}</p> : null}
    </div>
  );
}

function NextCue({ state, problem, reference }: { state: LiveState; problem: string | null; reference: ReferenceData | null }) {
  let text = '';
  let distance = '';
  let progress = 0;
  if (!problem) {
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
      <h2 id={titleId}>The attempt did not start</h2>
      <p>The exercise was already running when you pressed Start. Restart the exercise in the game.</p>
      <div className="missed-actions">
        <button type="button" className="stage-button primary" onClick={onDismiss}>
          OK
        </button>
      </div>
    </div>
  );
}

type StageProps = { state: LiveState; exercise: Exercise; finishedAttempt: string | null; clipsFailed: boolean; onDriveAgain(): void; onStop(): void };

function Stage({ state, exercise, finishedAttempt, clipsFailed, onDriveAgain, onStop }: StageProps) {
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
          <p>{`${state.attemptNumber === null ? 'Ready' : `Attempt ${state.attemptNumber}`} · ${exercise.name}`}</p>
          <div className="stage-row">
            <StageStatus status={telemetry} label="Telemetry" />
            <StageStatus status={voice} label="Voice" />
          </div>
        </div>
        <button type="button" className="stage-button" onClick={onStop}>
          Stop training
        </button>
      </div>
      <div className="stage-left">
        {finishedAttempt ? (
          <div className="stage-summary">
            <AttemptSummary key={finishedAttempt} attemptId={finishedAttempt} onDriveAgain={onDriveAgain} />
          </div>
        ) : (
          <>
            <CueArea state={state} problem={problem} reference={reference} />
            <NextCue state={state} problem={problem} reference={reference} />
            <LiveNumbers state={state} live={live} reference={reference} />
          </>
        )}
        {problem ? (
          <p className="stage-alert" role="alert">
            {problem}
          </p>
        ) : null}
        {clipsFailed && state.voiceDeviceId === deviceId ? (
          <p className="stage-alert" role="alert">
            {CLIPS_TEXT}
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

function VoiceBlock({ ensureClips, clipsFailed }: { ensureClips(): Promise<number>; clipsFailed: boolean }) {
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
          {loaded === null && clipsFailed ? null : <p className="sub">{loaded === null ? 'Loading the cues…' : `${counted(loaded, 'cue')} loaded.`}</p>}
          {clipsFailed ? (
            <p className="error" role="alert">
              {CLIPS_TEXT}
            </p>
          ) : null}
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

type ArmPanelProps = { exercise: Exercise; clipsFailed: boolean; onClipsFailed(failed: boolean): void; onArmed(): void };

function ArmPanel({ exercise, clipsFailed, onClipsFailed, onArmed }: ArmPanelProps) {
  const { deviceId } = useLiveConnection();
  const { state } = useLiveState(snapshot => snapshot);
  const demo = useDemo() !== null;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ensure = useReferenceClips(exercise.activeReferenceId);
  const loadClips = useCallback(
    () =>
      ensure().then(
        count => {
          onClipsFailed(false);
          return count;
        },
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
      <VoiceBlock ensureClips={loadClips} clipsFailed={clipsFailed} />
      <p className="sub">
        {demo
          ? 'The demo replays a recorded attempt in real time. It takes about 40 s. This screen shows the cues, and the voice device also says them.'
          : 'After you start, open the exercise in GT7 and drive. GT7 Tutor finds the start and the finish by itself.'}
      </p>
      <button className="btn arm-button" type="button" onClick={() => void arm()} disabled={busy}>
        {demo ? 'Play a demo attempt' : 'Start an attempt'}
      </button>
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
  const [justArmed, setJustArmed] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [clipsFailed, setClipsFailed] = useState(false);
  const liveArmed = state !== null && TRAINING_MODES.includes(state.mode) && state.exerciseId === exercise.id;
  const armed = liveArmed || justArmed;
  useImmersive(armed);

  const armedAt = useRef(0);
  useEffect(() => {
    if (!justArmed) return;
    if (liveArmed || (state?.mode === 'idle' && Date.now() - armedAt.current > ARM_SETTLE_MS)) setJustArmed(false);
  }, [liveArmed, state?.mode, state?.seq, justArmed]);

  const onArmed = () => {
    armedAt.current = Date.now();
    setJustArmed(true);
  };
  const disarm = async () => {
    setProblem(null);
    try {
      await api.disarm();
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'not-armed')) setProblem(errorText(error));
    }
    setJustArmed(false);
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
            exercise={exercise}
            finishedAttempt={finishedAttempt}
            clipsFailed={clipsFailed}
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
      <ArmPanel exercise={exercise} clipsFailed={clipsFailed} onClipsFailed={setClipsFailed} onArmed={onArmed} />
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
