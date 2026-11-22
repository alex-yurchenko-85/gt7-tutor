import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { KPH_PER_MPS, type Exercise, type LiveCue, type LiveState } from '@gt7/contracts';
import { api, ApiError } from '../../api/client.ts';
import { useLiveConnection, useLiveState } from '../../api/live.tsx';
import { cornerMarks } from '../../charts/corner-marks.ts';
import { TrackMap } from '../../charts/TrackMap.tsx';
import { rememberExercise, TRAINING_MODES } from '../../app/current-exercise.ts';
import { LoadProblem } from '../../app/NotFound.tsx';
import { useDemo } from '../../app/demo.tsx';
import { signedSeconds } from '../../app/format.ts';
import { useImmersive } from '../../app/immersive.tsx';
import { errorText } from '../../app/resource.ts';
import { useExercise } from '../exercise/use-exercise.ts';
import { paths, useRouter } from '../../app/router.tsx';
import { useSession } from '../../app/session.tsx';
import { telemetryStatus, voiceState, voiceStatus, type Status } from '../../app/status.ts';
import { AttemptSummary } from '../attempt-summary/AttemptSummary.tsx';
import { clipsText } from '../../voice/VoicePlayer.ts';
import { useVoiceClaim } from '../../voice/use-voice-claim.ts';
import { connectionProblem, cueNote, cueWords, guidanceText, shownOnDrive } from './cue-display.ts';
import { SeenCues } from './seen-cues.ts';
import { useMissedStart } from './missed-start.ts';
import { ARM_SETTLE_MS, forgetStartedTraining, startedTraining } from './start-drive.ts';
import { type ReferenceData, useReferenceData } from './use-reference-data.ts';
import './drive.css';
import { clipText, cuePhrase, t } from '../../app/i18n.ts';

const CUE_VISIBLE_MS = 3000;

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

type CueContent = { word: ReactNode; note: string | null; tone: 'cue' | 'armed' | 'idle' };

function cueContent(state: LiveState, problem: string | null, fresh: LiveCue | null, reference: ReferenceData | null): CueContent {
  const idle = (text: string): CueContent => ({ word: text, note: null, tone: 'idle' });
  if (problem) return idle('');
  if (state.mode === 'armed') return { word: t('drive.stage.ready'), note: null, tone: 'armed' };
  if (state.mode === 'paused') return idle(t('drive.stage.paused'));
  if (state.mode === 'finished') return idle(t('drive.stage.finished'));
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

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function readyText(demo: boolean, reference: ReferenceData | null, problem: string | null): { lead: string; note: string } {
  const spokenFirst = problem ? undefined : reference?.spoken[0];
  const first = spokenFirst ? cuePhrase(spokenFirst) : null;
  const lead = demo ? t('drive.demo.lead') : t('drive.ready.lead');
  if (!first) return { lead, note: demo ? t('drive.demo.note') : t('drive.ready.note') };
  return { lead, note: t(demo ? 'drive.demo.note-first-cue' : 'drive.ready.note-first-cue', { cue: sentence(first) }) };
}

function nextText(state: LiveState, problem: string | null): string | null {
  if (problem || !state.nextCue || state.sM === null) return null;
  return t('drive.stage.next', { cue: clipText(state.nextCue.clip), metres: Math.round(state.nextCue.inM) });
}

function StageText({ state, problem, reference }: { state: LiveState; problem: string | null; reference: ReferenceData | null }) {
  const demo = useDemo() !== null;
  const fresh = useFreshCue(shownOnDrive(state.lastCue) ? state.lastCue : null);
  const content = cueContent(state, problem, fresh, reference);
  const ready = state.mode === 'armed';
  const text = ready ? readyText(demo, reference, problem) : { lead: nextText(state, problem), note: content.note };
  return (
    <div className={ready ? 'stage-text' : 'stage-text running'}>
      <div className={`cue ${content.tone}${ready ? '' : ' running'}`} role="status">
        <div className="cue-word">{content.word}</div>
      </div>
      {text.lead || !ready ? <p className="race-lead">{text.lead}</p> : null}
      {text.note || !ready ? <p className="race-note">{text.note}</p> : null}
      {ready ? <StageVoice state={state} /> : null}
    </div>
  );
}

function LiveNumbers({ state, live, reference }: { state: LiveState; live: boolean; reference: ReferenceData | null }) {
  const values = [
    { value: !live || state.speedMps === null ? '–' : String(Math.round(state.speedMps * KPH_PER_MPS)), caption: t('drive.stage.kph'), tone: '' },
    { value: !live || state.sM === null ? '–' : String(Math.round(state.sM)), caption: reference ? t('drive.stage.of-length', { length: Math.round(reference.trace.lengthM) }) : t('drive.stage.from-start'), tone: '' },
    { value: !live || state.gapMs === null ? '–' : signedSeconds(state.gapMs, 1), caption: t('drive.stage.to-reference'), tone: 'gap' }
  ];
  return (
    <div className="race-stats live-numbers">
      {values.map(item => (
        <div key={item.tone || item.caption} className={item.tone ? `race-stat ${item.tone}` : 'race-stat'}>
          <b>{item.value}</b>
          <span>{item.caption}</span>
        </div>
      ))}
    </div>
  );
}

const DOT_COLOUR: Record<Status['tone'], string> = { on: ' green', warn: ' yellow', off: ' red', idle: '' };

function StageStatus({ status, label }: { status: Status; label: string }) {
  return (
    <span className="stage-status" title={status.text}>
      <span className={`race-dot${DOT_COLOUR[status.tone]}`} />
      {label}
    </span>
  );
}

function StageVoice({ state }: { state: LiveState }) {
  const { deviceId } = useLiveConnection();
  const voice = useVoiceClaim();
  const where = voiceState(state, deviceId);
  if (where === 'here' || where === 'elsewhere') return null;
  return (
    <div className="stage-voice">
      <p className="race-note">{t('drive.voice.none')}</p>
      <button className="stage-button" type="button" onClick={() => void voice.claim()} disabled={voice.busy}>
        {t('drive.voice.use')}
      </button>
      {voice.problem ? (
        <p className="stage-alert" role="alert">
          {voice.problem}
        </p>
      ) : null}
    </div>
  );
}

function MissedStart({ onDismiss }: { onDismiss(): void }) {
  return (
    <div className="missed-start" role="alert">
      <h2>{t('drive.missed.title')}</h2>
      <p>{t('drive.missed.text')}</p>
      <div className="missed-actions">
        <button type="button" className="stage-button primary" onClick={onDismiss}>
          {t('drive.missed.ok')}
        </button>
      </div>
    </div>
  );
}

type StageProps = {
  state: LiveState;
  exercise: Exercise;
  reference: ReferenceData | null;
  finishedAttempt: string | null;
  clipsFailed: boolean;
  onDriveAgain(): void;
  onStop(): void;
};

function Stage({ state, exercise, reference, finishedAttempt, clipsFailed, onDriveAgain, onStop }: StageProps) {
  const { deviceId } = useLiveConnection();
  const { connected } = useLiveState(snapshot => snapshot);
  const demo = useDemo() !== null;
  const telemetry = telemetryStatus(state, connected, demo);
  const voice = voiceStatus(state, deviceId);
  const problem = connectionProblem(state, connected, demo);
  const live = problem === null;
  const missedStart = useMissedStart(state);
  const marks = useMemo(() => (reference ? cornerMarks(reference.corners) : []), [reference]);

  return (
    <div className="drive-stage" data-surface="night">
      <div className="stage-top">
        <div className="stage-title">
          <p className="race-status-word stage-status-row">
            <StageStatus status={telemetry} label={t('drive.stage.telemetry')} />
            <StageStatus status={voice} label={t('drive.stage.voice')} />
          </p>
          <p className="race-status-sub">{state.attemptNumber === null ? exercise.name : t('drive.stage.attempt', { number: state.attemptNumber, name: exercise.name })}</p>
        </div>
        <button type="button" className="stage-button" onClick={onStop}>
          {t('drive.stage.stop')}
        </button>
      </div>
      <div className="stage-left">
        {finishedAttempt ? (
          <div className="stage-summary">
            <AttemptSummary key={finishedAttempt} attemptId={finishedAttempt} onDriveAgain={onDriveAgain} />
          </div>
        ) : (
          <>
            <StageText state={state} problem={problem} reference={reference} />
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
            {clipsText()}
          </p>
        ) : null}
        {!state.recordingComplete ? (
          <p className="stage-alert" role="alert">
            {state.storageError ? t('drive.stage.incomplete-error', { error: state.storageError }) : t('drive.stage.incomplete')}
          </p>
        ) : null}
        {missedStart.missed ? <MissedStart onDismiss={missedStart.dismiss} /> : null}
      </div>
      {reference ? (
        <div className="stage-map">
          <TrackMap
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

function DriveExercise({ exercise }: { exercise: Exercise }) {
  const { state } = useLiveState(snapshot => snapshot);
  const { navigate } = useRouter();
  const [started] = useState(() => startedTraining(exercise.id, Date.now()));
  const [justArmed, setJustArmed] = useState(started !== null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const reference = useReferenceData(exercise.activeReferenceId);
  const liveArmed = state !== null && TRAINING_MODES.includes(state.mode) && state.exerciseId === exercise.id;
  const armed = liveArmed || justArmed;
  useImmersive(armed);
  useEffect(() => forgetStartedTraining(), []);

  const armedAt = useRef(Date.now());
  useEffect(() => {
    if (!justArmed) return;
    if (liveArmed || (state !== null && !TRAINING_MODES.includes(state.mode) && Date.now() - armedAt.current > ARM_SETTLE_MS)) setJustArmed(false);
  }, [liveArmed, state, justArmed]);

  const attempts = paths.attempts(exercise.id);
  const off = state !== null && !armed;
  useEffect(() => {
    if (off) navigate(attempts, { replace: true });
  }, [off, attempts, navigate]);

  const stop = async () => {
    setProblem(null);
    try {
      await api.disarm();
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'not-armed')) {
        setProblem(errorText(error));
        return;
      }
    }
    setJustArmed(false);
    navigate(attempts, { replace: true });
  };

  const [earlierAttempt, setEarlierAttempt] = useState<string | null | undefined>(undefined);
  const running = state !== null && (state.mode === 'armed' || state.mode === 'driving' || state.mode === 'paused');
  if (running && earlierAttempt !== state.lastAttemptId) setEarlierAttempt(state.lastAttemptId);
  const newAttempt = state?.mode === 'finished' && state.lastAttemptId && state.lastAttemptId !== earlierAttempt ? state.lastAttemptId : null;
  const finishedAttempt = newAttempt !== dismissed ? newAttempt : null;

  if (!state) return <p className="sub">{t('drive.connecting')}</p>;
  if (!armed) return null;
  return (
    <>
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
      <Stage
        state={state}
        exercise={exercise}
        reference={reference.data ?? null}
        finishedAttempt={finishedAttempt}
        clipsFailed={started?.clipsFailed ?? false}
        onDriveAgain={() => finishedAttempt && setDismissed(finishedAttempt)}
        onStop={() => void stop()}
      />
    </>
  );
}

export function DriveView({ exerciseId }: { exerciseId: string }) {
  const { user } = useSession();
  const exercise = useExercise(exerciseId);
  const loadedId = exercise.data?.id ?? null;
  useEffect(() => {
    if (loadedId) rememberExercise(user.id, loadedId);
  }, [user.id, loadedId]);
  if (exercise.error) return <LoadProblem error={exercise.error} kind="exercise" />;
  if (!exercise.data) return <p className="sub">{t('drive.reading')}</p>;
  return <DriveExercise exercise={exercise.data} />;
}
