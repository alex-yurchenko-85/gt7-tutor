import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { CaptureInfo, ReferenceCheckResult, ReferenceProposal, StartKindName } from '@gt7/contracts';
import { api, ApiError } from '../../api/client.ts';
import { useLiveConnection, useLiveState } from '../../api/live.tsx';
import { Icon } from '../../app/icons.tsx';
import { useImmersive } from '../../app/immersive.tsx';
import { useWideLayout } from '../../app/layout.ts';
import { LoadProblem } from '../../app/NotFound.tsx';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { consoleState, voiceState, type ConsoleState, type Status, type VoiceState } from '../../app/status.ts';
import { COUNTDOWN_CLIPS } from '../../voice/clips.ts';
import { useExercise } from '../exercise/use-exercise.ts';
import { ReadinessChip } from '../setup/SetupView.tsx';
import './record.css';

const STANDARD_DELAYS_S = [5, 10, 15];
const CHECK_DELAYS_S = [5];

type Active = { capture: CaptureInfo; startedAt: number; delayS: number };

function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

const SPOKEN_WORDS = ['start', 'one', 'two', 'three'];
const CONSOLE_MISSING = 'Enter the PS5 address in Setup first.';

type Clock = { secondsLeft: number; recordingS: number };

function clockOf(active: Active, now: number): Clock {
  const sinceStart = Math.max(0, now - active.startedAt) / 1000 - active.delayS;
  return { secondsLeft: Math.max(0, Math.ceil(-sinceStart)), recordingS: Math.max(0, Math.floor(sinceStart)) };
}

function useRunningCapture(exerciseId: string, active: Active | null, setActive: (active: Active) => void): void {
  const captures = useResource(() => api.captures(), [exerciseId]);
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || active || !captures.data) return;
    const running = captures.data.find(capture => capture.active && capture.exerciseId === exerciseId && capture.purpose === 'demo');
    resumed.current = true;
    if (running) setActive({ capture: running, startedAt: Date.parse(running.startedAt), delayS: (running.startCueMonoMs ?? 0) / 1000 });
  }, [captures.data, active, exerciseId, setActive]);
}

function problemText(error: unknown): string {
  if (error instanceof ApiError && error.code === 'console-address-missing') return CONSOLE_MISSING;
  if (error instanceof ApiError && error.code === 'busy') return 'Another capture or training is active. Stop it first.';
  if (error instanceof ApiError && error.code === 'no-timer-run') {
    return 'This range does not hold the whole run of the demonstration timer. Choose frames from before the demonstration starts to after it finishes.';
  }
  return errorText(error);
}

function StartKindChoice({ name, value, onChange }: { name: string; value: StartKindName | null; onChange(kind: StartKindName): void }) {
  return (
    <fieldset className="choice">
      <legend>How does the exercise start?</legend>
      <label>
        <input type="radio" name={name} checked={value === 'flying'} onChange={() => onChange('flying')} />
        <span>
          <b>Flying start</b>
          <small>The car is already moving when the section begins.</small>
        </span>
      </label>
      <label>
        <input type="radio" name={name} checked={value === 'standing'} onChange={() => onChange('standing')} />
        <span>
          <b>Standing start</b>
          <small>The car stands still at the start line.</small>
        </span>
      </label>
    </fieldset>
  );
}

type ProposalProps = { exerciseId: string; captures: CaptureInfo[]; proposals: ReferenceProposal[]; onCreated(): void };

function Proposal({ exerciseId, captures, proposals, onCreated }: ProposalProps) {
  const [selected, setSelected] = useState<number | null>(proposals.length === 1 && !proposals[0]!.ambiguous ? 0 : null);
  const [startKind, setStartKind] = useState<StartKindName | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const recordingNumber = (captureId: string) => captures.findIndex(capture => capture.id === captureId) + 1;

  const confirm = async () => {
    const proposal = selected === null ? null : proposals[selected];
    const range = proposal?.ranges[0];
    if (!range || !startKind) return;
    setProblem(null);
    try {
      await api.createReference({ exerciseId, captureId: range.captureId, first: range.first, last: range.last, startKind });
      onCreated();
    } catch (error) {
      setProblem(problemText(error));
    }
  };
  return (
    <div className="panel proposal">
      <h2>Confirm the range</h2>
      {proposals.length > 1 || proposals[0]!.ambiguous ? (
        <p className="notice">More than one range repeats in the recordings. Select the one that shows the demonstration from start to finish.</p>
      ) : (
        <p className="sub">One range repeats in every recording. Check it and confirm.</p>
      )}
      <fieldset className="choice" role="radiogroup" aria-label="Candidate ranges">
        <legend>Candidate ranges</legend>
        {proposals.map((proposal, index) => (
          <label key={index}>
            <input type="radio" name="candidate" checked={selected === index} onChange={() => setSelected(index)} />
            <span>
              <b>
                {proposal.sampleCount} samples, about {(proposal.sampleCount / 60).toFixed(1)} s
              </b>
              <small>
                {proposal.ranges.map(range => `recording ${recordingNumber(range.captureId)}: frames ${range.first}–${range.last}`).join('; ')}
              </small>
              <small>{proposal.evidence.join('. ')}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <StartKindChoice name="proposal-start" value={startKind} onChange={setStartKind} />
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
      <button className="btn" type="button" disabled={selected === null || startKind === null} onClick={() => void confirm()}>
        Confirm reference
      </button>
    </div>
  );
}

function ManualRange({ exerciseId, onCreated }: { exerciseId: string; onCreated(): void }) {
  const captures = useResource(() => api.captures(), []);
  const usable = (captures.data ?? []).filter(capture => capture.exerciseId === exerciseId && !capture.active);
  const [captureId, setCaptureId] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [startKind, setStartKind] = useState<StartKindName | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const chosen = captureId || usable[0]?.id || '';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const firstFrame = Number(first);
    const lastFrame = Number(last);
    if (!chosen) return setProblem('There is no stopped capture for this exercise.');
    if (!Number.isInteger(firstFrame) || !Number.isInteger(lastFrame) || first === '' || last === '' || firstFrame < 0 || lastFrame < firstFrame) {
      return setProblem('Enter whole frame numbers, with the last frame not before the first.');
    }
    if (!startKind) return setProblem('Select how the exercise starts.');
    setProblem(null);
    try {
      await api.createReference({ exerciseId, captureId: chosen, first: firstFrame, last: lastFrame, startKind });
      onCreated();
    } catch (error) {
      setProblem(problemText(error));
    }
  };

  return (
    <form className="panel manual" aria-label="Manual range" onSubmit={submit} noValidate>
      <h2>Set the range by hand</h2>
      <p className="sub">For an experienced user: select one capture and the first and last frame of the demonstration. Both frames are included.</p>
      <p className="sub">GT7 Tutor keeps only the part where the demonstration timer runs.</p>
      <div className="field">
        <label htmlFor="manual-capture">Capture</label>
        <select id="manual-capture" value={chosen} onChange={event => setCaptureId(event.target.value)}>
          {usable.map(capture => (
            <option key={capture.id} value={capture.id}>
              {new Date(capture.startedAt).toLocaleString('en-GB')}, {capture.purpose === 'demo' ? 'demonstration' : 'own driving'}, {capture.packets} packets
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="manual-first">First frame</label>
          <input id="manual-first" inputMode="numeric" value={first} onChange={event => setFirst(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="manual-last">Last frame</label>
          <input id="manual-last" inputMode="numeric" value={last} onChange={event => setLast(event.target.value)} />
        </div>
      </div>
      <StartKindChoice name="manual-start" value={startKind} onChange={setStartKind} />
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
      <button className="btn" type="submit">
        Create reference
      </button>
    </form>
  );
}

function checkText(result: ReferenceCheckResult): string {
  return result.matched
    ? 'The new recording matches the reference. The reference is confirmed for this game version.'
    : 'The new recording does not match the reference. Record a new reference with the three recordings.';
}

const CONSOLE_CHIPS: Record<ConsoleState, Status> = {
  'recorded-data': { tone: 'on', text: 'Console: recorded data' },
  'no-address': { tone: 'off', text: 'Console: no address' },
  receiving: { tone: 'on', text: 'Console: receiving telemetry' },
  'address-saved': { tone: 'idle', text: 'Console: address saved' }
};

const VOICE_CHIPS: Record<VoiceState, Status> = {
  none: { tone: 'warn', text: 'Voice: no device, the countdown is shown only' },
  elsewhere: { tone: 'on', text: 'Voice: another device speaks the countdown' },
  here: { tone: 'on', text: 'Voice: this device speaks the countdown' },
  'here-not-ready': { tone: 'warn', text: 'Voice: this device, audio not started' }
};

function spokenLine(voice: VoiceState, secondsLeft: number, wide: boolean): string {
  if (voice === 'none') return wide ? 'No device speaks the countdown. Start the demonstration at START.' : 'No voice. Start at START.';
  if (secondsLeft > 3) return wide ? 'The voice starts at three.' : 'Voice: from three';
  const word = SPOKEN_WORDS[secondsLeft]!;
  return wide ? `The voice says “${word}”.` : `Voice: “${word}”`;
}

function idleHint(voice: VoiceState, delayS: number, wide: boolean): string {
  if (voice === 'none') {
    return wide
      ? `Then press Start here. This screen counts down from ${delayS}. On START, start the demonstration in the game.`
      : `This screen counts down from ${delayS}. On START, start the demonstration.`;
  }
  return wide
    ? `Then press Start here. The voice counts down from ${delayS}. On “start”, start the demonstration in the game.`
    : `Put the phone by the TV. The voice counts down from ${delayS}. On “start”, start the demonstration.`;
}

function captureSeconds(capture: CaptureInfo): number | null {
  if (!capture.endedAt) return null;
  return Math.max(1, Math.round((Date.parse(capture.endedAt) - Date.parse(capture.startedAt)) / 1000));
}

function slotNote(delayS: number, done: CaptureInfo | undefined, wide: boolean): string {
  if (!done) return wide ? `start after ${delayS} s` : `after ${delayS} s`;
  const seconds = captureSeconds(done);
  return seconds === null ? 'done' : `done, ${seconds} s`;
}

function Slots({ delays, recorded, current, wide }: { delays: number[]; recorded: CaptureInfo[]; current: number | null; wide: boolean }) {
  return (
    <ol className="record-slots" aria-label="Recordings">
      {delays.map((delay, index) => {
        const state = index < recorded.length ? 'done' : index === current ? 'now' : undefined;
        return (
          <li key={index} className={state} aria-current={state === 'now' ? 'step' : undefined}>
            <b>{wide ? `Recording ${index + 1}` : `${index + 1} of ${delays.length}`}</b>
            <span>{slotNote(delay, recorded[index], wide)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function SetupProblem({ text }: { text: string }) {
  return (
    <p className="error" role="alert">
      {text}
      {text === CONSOLE_MISSING ? (
        <>
          {' '}
          <Link to={paths.setup('console')}>Open Setup</Link>
        </>
      ) : null}
    </p>
  );
}

function SideNotes({ check, manualOpen, onManual }: { check: boolean; manualOpen: boolean; onManual(): void }) {
  return (
    <aside className="record-side">
      {check ? null : (
        <div className="panel">
          <h2>Why three times</h2>
          <p>Each recording starts after a different wait: 5, 10 and 15 s. The demonstration is the part that stays the same, so GT7 Tutor finds it by itself.</p>
        </div>
      )}
      <div className="panel">
        <h2>The phone as the voice device</h2>
        <p>Put the phone next to the TV. It shows the same countdown in large type.</p>
      </div>
      {check || manualOpen ? null : <ManualHint onManual={onManual} />}
    </aside>
  );
}

function ManualHint({ onManual }: { onManual(): void }) {
  return (
    <p className="record-manual-hint">
      <span>Experienced user?</span>{' '}
      <button type="button" className="text-link" onClick={onManual}>
        Set the range by hand
      </button>
    </p>
  );
}

export function RecordView({ exerciseId }: { exerciseId: string }) {
  const exercise = useExercise(exerciseId);
  const wide = useWideLayout();
  const { search } = useRouter();
  const { deviceId, player } = useLiveConnection();
  const { state, connected } = useLiveState(snapshot => snapshot);
  const settings = useResource(() => api.settings(), []);
  const info = useResource(() => api.appInfo(), []);
  const checkId = search.get('check');
  const delays = checkId ? CHECK_DELAYS_S : STANDARD_DELAYS_S;
  const [recorded, setRecorded] = useState<CaptureInfo[]>([]);
  const [active, setActive] = useState<Active | null>(null);
  const [proposals, setProposals] = useState<ReferenceProposal[] | null>(null);
  const [checkResult, setCheckResult] = useState<ReferenceCheckResult | null>(null);
  const [created, setCreated] = useState(false);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [finishFailed, setFinishFailed] = useState(false);
  const now = useNow(active !== null);
  const voice = voiceState(state, deviceId);
  const voiceHere = voice === 'here' || voice === 'here-not-ready';
  useRunningCapture(exerciseId, active, setActive);
  useImmersive(!wide);
  useEffect(() => {
    if (voiceHere) player.preload(COUNTDOWN_CLIPS).catch(() => undefined);
  }, [voiceHere, player]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await action();
    } catch (error) {
      setProblem(problemText(error));
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      const delayS = delays[recorded.length]!;
      const capture = await api.startCapture({ exerciseId, purpose: 'demo', startAfterS: delayS });
      setActive({ capture, startedAt: Date.now(), delayS });
    });

  const finish = async (all: CaptureInfo[]) => {
    setFinishFailed(false);
    try {
      if (checkId) setCheckResult(await api.checkReference(checkId, all.at(-1)!.id));
      else setProposals(await api.proposeReference(exerciseId, all.map(capture => capture.id)));
    } catch (error) {
      setFinishFailed(true);
      throw error;
    }
  };

  const stop = () =>
    run(async () => {
      if (!active) return;
      const stopped = await api.stopCapture(active.capture.id);
      setActive(null);
      const all = [...recorded, stopped];
      setRecorded(all);
      if (all.length >= delays.length) await finish(all);
    });

  const cancel = () =>
    run(async () => {
      if (!active) return;
      await api.stopCapture(active.capture.id);
      setActive(null);
    });

  const retry = () => run(() => finish(recorded));

  const recordAgain = () => {
    setRecorded([]);
    setProposals(null);
    setProblem(null);
  };

  if (exercise.error) return <LoadProblem error={exercise.error} kind="exercise" />;
  if (!exercise.data) return <p className="sub">Reading the exercise…</p>;
  const finished = recorded.length >= delays.length;
  const number = recorded.length + 1;
  const consoleRequired = info.data?.consoleRequired ?? false;
  const ps5Ip = settings.data?.ps5Ip;
  const startBlocked = consoleRequired && ps5Ip === null;
  const consoleChip = CONSOLE_CHIPS[consoleState(ps5Ip, state, connected, !consoleRequired)];
  const voiceChip = VOICE_CHIPS[voice];
  const clock = active ? clockOf(active, now) : null;
  const shownProblem = problem ?? (startBlocked && !active && !finished ? CONSOLE_MISSING : null);
  const title = checkId ? 'Check the reference' : 'Record the reference';
  const lede = checkId
    ? 'One recording of the demonstration shows whether the stored reference still matches the game.'
    : 'The game shows the same demonstration before every run. GT7 Tutor records it three times with different waits and keeps the part that repeats.';

  const stageBody = (): ReactNode => {
    if (created) {
      return (
        <div className="record-message">
          <h2 className="record-done">The reference is active</h2>
          <p>Next: three baseline attempts without voice. You can skip them.</p>
          <div className="record-actions">
            <Link to={paths.exercise(exerciseId)} className="stage-button primary">
              Back to the exercise
            </Link>
            <Link to={paths.cues(exerciseId)} className="stage-button">
              Hear the cues
            </Link>
          </div>
        </div>
      );
    }
    if (finished && proposals?.length === 0) {
      return (
        <div className="record-message">
          <h2>No complete demonstration found</h2>
          <p>
            A range must repeat in every recording and show the timer of the demonstration from start to finish. Record again and let each demonstration play to the end, or set the range by hand.
          </p>
          <button className="stage-button primary" type="button" onClick={recordAgain}>
            Record again
          </button>
        </div>
      );
    }
    if (finished) {
      return (
        <div className="record-message">
          <h2>{checkId ? 'The recording is done' : 'Three recordings done'}</h2>
          {checkResult ? (
            <p className={`notice${checkResult.matched ? '' : ' bad'}`} role="status">
              {checkText(checkResult)}
            </p>
          ) : null}
          {proposals ? <Proposal exerciseId={exerciseId} captures={recorded} proposals={proposals} onCreated={() => setCreated(true)} /> : null}
          {shownProblem ? <SetupProblem text={shownProblem} /> : null}
          {finishFailed ? (
            <button className="stage-button primary" type="button" onClick={() => void retry()} disabled={busy}>
              Try again
            </button>
          ) : null}
          {checkResult ? (
            <div className="record-actions">
              <Link to={paths.exercise(exerciseId)} className="stage-button primary">
                Back to the exercise
              </Link>
            </div>
          ) : null}
        </div>
      );
    }
    if (active && clock) {
      const recording = clock.secondsLeft === 0;
      return (
        <div className="record-live">
          <div className={`record-count${recording ? ' go' : ''}`} role="timer">
            {recording ? 'START' : clock.secondsLeft}
          </div>
          {recording && wide ? (
            <p className="record-line">
              <span className="record-dot" aria-hidden="true" />
              <span>Recording, {clock.recordingS} s. Stop when the demonstration has ended.</span>
            </p>
          ) : recording ? (
            <>
              <p className="record-line">
                <span className="record-dot" aria-hidden="true" />
                <span>Recording, {clock.recordingS} s</span>
              </p>
              <p className="record-note">Stop when the demonstration has ended.</p>
            </>
          ) : (
            <p className="record-line">
              {wide && voice !== 'none' ? <Icon name="speaker" /> : null}
              <span>{spokenLine(voice, clock.secondsLeft, wide)}</span>
            </p>
          )}
          {shownProblem ? <SetupProblem text={shownProblem} /> : null}
          {wide && recording ? (
            <button className="stage-button light" type="button" onClick={() => void stop()} disabled={busy}>
              Stop recording {number}
            </button>
          ) : null}
        </div>
      );
    }
    return (
      <div className="record-message">
        <h2>{wide ? 'In GT7, open the exercise and stay on the screen before the demonstration.' : 'Open the exercise in GT7 and wait before the demonstration.'}</h2>
        <p>{idleHint(voice, delays[recorded.length]!, wide)}</p>
        {shownProblem ? <SetupProblem text={shownProblem} /> : null}
        {wide ? (
          <button className="stage-button primary" type="button" onClick={() => void start()} disabled={busy || startBlocked}>
            Start recording {number} of {delays.length}
          </button>
        ) : null}
      </div>
    );
  };

  const phoneAction = (): ReactNode => {
    if (created || finished) return null;
    if (active && clock) {
      return clock.secondsLeft === 0 ? (
        <button className="stage-button light wide" type="button" onClick={() => void stop()} disabled={busy}>
          Stop recording {number}
        </button>
      ) : (
        <button className="stage-button wide" type="button" onClick={() => void cancel()} disabled={busy}>
          Cancel
        </button>
      );
    }
    return (
      <button className="stage-button primary wide" type="button" onClick={() => void start()} disabled={busy || startBlocked}>
        Start recording {number}
      </button>
    );
  };

  const current = finished ? null : recorded.length;

  if (!wide) {
    return (
      <section className="record-phone" aria-label={title}>
        <div className="record-stage">
          <div className="record-top">
            <div>
              <p>
                {checkId ? 'Check' : 'Reference'} · {exercise.data.name}
              </p>
              <ul className="record-dots" aria-label="Readiness">
                <li title={consoleChip.text}>
                  <span className={`dot ${consoleChip.tone}`} aria-hidden="true" />
                  {consoleRequired ? 'Telemetry' : 'Recorded data'}
                </li>
                <li title={voiceChip.text}>
                  <span className={`dot ${voiceChip.tone}`} aria-hidden="true" />
                  {voice === 'none' ? 'No voice' : 'Voice'}
                </li>
              </ul>
            </div>
            <Link to={paths.exercise(exerciseId)} className="stage-button">
              Close
            </Link>
          </div>
          <Slots delays={delays} recorded={recorded} current={current} wide={false} />
          <div className="record-body">{stageBody()}</div>
          <div className="record-bottom">{phoneAction()}</div>
        </div>
        {checkId || created ? null : (
          <div className="record-after">
            {manual ? <ManualRange exerciseId={exerciseId} onCreated={() => setCreated(true)} /> : <ManualHint onManual={() => setManual(true)} />}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="record">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={paths.exercises()}>Exercises</Link> / <Link to={paths.exercise(exerciseId)}>{exercise.data.name}</Link> / Reference
      </nav>
      <h1>{title}</h1>
      <p className="lede">{lede}</p>
      <ul className="setup-chips" aria-label="Readiness">
        <ReadinessChip status={consoleChip} />
        <ReadinessChip status={voiceChip} />
      </ul>
      <div className="record-cols">
        <div className="record-stage">
          <Slots delays={delays} recorded={recorded} current={current} wide />
          <div className="record-body">{stageBody()}</div>
          {active ? (
            <button type="button" className="text-link record-cancel" onClick={() => void cancel()} disabled={busy}>
              Cancel this recording
            </button>
          ) : null}
        </div>
        <div>
          <SideNotes check={checkId !== null} manualOpen={manual || created} onManual={() => setManual(true)} />
          {manual && !created ? <ManualRange exerciseId={exerciseId} onCreated={() => setCreated(true)} /> : null}
        </div>
      </div>
    </section>
  );
}
