import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { CaptureInfo, ReferenceCheckResult, ReferenceProposal } from '@gt7/contracts';
import { api, ApiError } from '../../api/client.ts';
import { useLiveState } from '../../api/live.tsx';
import { useImmersive } from '../../app/immersive.tsx';
import { useWideLayout } from '../../app/layout.ts';
import { LoadProblem } from '../../app/NotFound.tsx';
import { formatTime } from '../../app/format.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { consoleState, type ConsoleState, type Status } from '../../app/status.ts';
import { useExercise } from '../exercise/use-exercise.ts';
import { ReadinessChip } from '../setup/SetupView.tsx';
import './record.css';

type Active = { capture: CaptureInfo; startedAt: number };

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

const CONSOLE_MISSING = 'Enter the PS5 address in Setup first.';

function recordingSeconds(active: Active, now: number): number {
  return Math.max(0, Math.floor((now - active.startedAt) / 1000));
}

function useRunningCapture(exerciseId: string, active: Active | null, setActive: (active: Active) => void): void {
  const captures = useResource(() => api.captures(), [exerciseId]);
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || active || !captures.data) return;
    const running = captures.data.find(capture => capture.active && capture.exerciseId === exerciseId && capture.purpose === 'demo');
    resumed.current = true;
    if (running) setActive({ capture: running, startedAt: Date.parse(running.startedAt) });
  }, [captures.data, active, exerciseId, setActive]);
}

function problemText(error: unknown): string {
  if (error instanceof ApiError && error.code === 'console-address-missing') return CONSOLE_MISSING;
  if (error instanceof ApiError && error.code === 'busy') return 'Another recording or training runs. Stop it first.';
  if (error instanceof ApiError && error.code === 'no-timer-run') {
    return 'This range does not hold the whole demonstration. Choose frames from before the start to after the end of the demonstration.';
  }
  return errorText(error);
}

function runLabel(proposal: ReferenceProposal): string {
  const range = proposal.ranges[0]!;
  return `${formatTime(proposal.timeMs)}, frames ${range.first}–${range.last}`;
}

function foundText(proposal: ReferenceProposal): string {
  const range = proposal.ranges[0]!;
  return `The demonstration takes ${formatTime(proposal.timeMs)} in recording 1, frames ${range.first}–${range.last}. Use it as the reference, or record once more to check that the same part repeats.`;
}

function needsSelection(proposals: ReferenceProposal[]): boolean {
  return proposals.length > 1 || proposals[0]!.ambiguous;
}

function sameRun(a: ReferenceProposal, b: ReferenceProposal): boolean {
  return a.ranges[0]!.first === b.ranges[0]!.first && a.ranges[0]!.last === b.ranges[0]!.last;
}

type RunChoiceProps = { proposals: ReferenceProposal[]; selected: number | null; onSelect(index: number): void };

function RunChoice({ proposals, selected, onSelect }: RunChoiceProps) {
  return (
    <fieldset className="choice" role="radiogroup" aria-label="Demonstrations">
      <legend>Demonstrations in recording 1</legend>
      {proposals.map((proposal, index) => (
        <label key={index}>
          <input type="radio" name="run" checked={selected === index} onChange={() => onSelect(index)} />
          <span>{runLabel(proposal)}</span>
        </label>
      ))}
    </fieldset>
  );
}

function ManualRange({ exerciseId, onCreated }: { exerciseId: string; onCreated(): void }) {
  const captures = useResource(() => api.captures(), []);
  const usable = (captures.data ?? []).filter(capture => capture.exerciseId === exerciseId && !capture.active);
  const [captureId, setCaptureId] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const chosen = captureId || usable[0]?.id || '';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const firstFrame = Number(first);
    const lastFrame = Number(last);
    if (!chosen) return setProblem('This exercise has no finished recording.');
    if (!Number.isInteger(firstFrame) || !Number.isInteger(lastFrame) || first === '' || last === '' || firstFrame < 0 || lastFrame < firstFrame) {
      return setProblem('Enter whole frame numbers, with the last frame not before the first.');
    }
    setProblem(null);
    try {
      await api.createReference({ exerciseId, captureId: chosen, first: firstFrame, last: lastFrame });
      onCreated();
    } catch (error) {
      setProblem(problemText(error));
    }
  };

  return (
    <form className="panel manual" aria-label="Manual range" onSubmit={submit} noValidate>
      <h2>Set the range by hand</h2>
      <p className="sub">For an experienced user: select one capture and the first and last frame of the demonstration. Both frames are included.</p>
      <p className="sub">GT7 Tutor keeps only the part of the range that holds the demonstration.</p>
      <div className="field">
        <label htmlFor="manual-capture">Recording</label>
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
    : 'The new recording does not match the reference. Record a new reference.';
}

const CONSOLE_CHIPS: Record<ConsoleState, Status> = {
  'recorded-data': { tone: 'on', text: 'Console: recorded data' },
  'no-address': { tone: 'off', text: 'Console: no address' },
  receiving: { tone: 'on', text: 'Console: receiving telemetry' },
  'address-saved': { tone: 'idle', text: 'Console: address saved' }
};

const IDLE_HINT = 'Then press Start recording here, and start the demonstration in the game. Stop when the demonstration has ended.';

function captureSeconds(capture: CaptureInfo): number | null {
  if (!capture.endedAt) return null;
  return Math.max(1, Math.round((Date.parse(capture.endedAt) - Date.parse(capture.startedAt)) / 1000));
}

function doneNote(capture: CaptureInfo): string {
  const seconds = captureSeconds(capture);
  return seconds === null ? 'done' : `done, ${seconds} s`;
}

type Slot = { note: string; state: 'done' | 'now' | null };

function Slots({ slots }: { slots: Slot[] }) {
  return (
    <ol className="record-slots" aria-label="Recordings">
      {slots.map((slot, index) => (
        <li key={index} className={slot.state ?? undefined} aria-current={slot.state === 'now' ? 'step' : undefined}>
          <b>Recording {index + 1}</b>
          <span>{slot.note}</span>
        </li>
      ))}
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
          <h2>Why one recording</h2>
          <p>
            GT7 Tutor finds the start and the end of the demonstration in one recording. A second recording is optional: it checks that the same part repeats.
          </p>
        </div>
      )}
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
  const { state, connected } = useLiveState(snapshot => snapshot);
  const settings = useResource(() => api.settings(), []);
  const info = useResource(() => api.appInfo(), []);
  const checkId = search.get('check');
  const [recorded, setRecorded] = useState<CaptureInfo[]>([]);
  const [active, setActive] = useState<Active | null>(null);
  const [proposals, setProposals] = useState<ReferenceProposal[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [repeats, setRepeats] = useState<ReferenceProposal[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<ReferenceCheckResult | null>(null);
  const [created, setCreated] = useState(false);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [finishFailed, setFinishFailed] = useState(false);
  const now = useNow(active !== null);
  useRunningCapture(exerciseId, active, setActive);
  useImmersive(!wide);

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
      const capture = await api.startCapture({ exerciseId, purpose: 'demo' });
      setActive({ capture, startedAt: Date.now() });
    });

  const finish = async (all: CaptureInfo[]) => {
    setFinishFailed(false);
    try {
      if (checkId) setCheckResult(await api.checkReference(checkId, all.at(-1)!.id));
      else if (all.length > 1) setRepeats(await api.proposeReference(exerciseId, all.map(capture => capture.id)));
      else {
        const found = await api.proposeReference(exerciseId, [all[0]!.id]);
        setProposals(found);
        setSelected(found.length === 1 && !found[0]!.ambiguous ? 0 : null);
      }
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
      await finish(all);
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
    setSelected(null);
    setRepeats(null);
    setChecking(false);
    setProblem(null);
  };

  const chosen = selected === null ? null : (proposals?.[selected] ?? null);

  const createFromChosen = () =>
    run(async () => {
      const range = chosen?.ranges[0];
      if (!range) return;
      await api.createReference({ exerciseId, captureId: range.captureId, first: range.first, last: range.last });
      setCreated(true);
    });

  if (exercise.error) return <LoadProblem error={exercise.error} kind="exercise" />;
  if (!exercise.data) return <p className="sub">Reading the exercise…</p>;
  const count = checkId ? 1 : 2;
  const waiting = recorded.length > 0 && (checkId ? checkResult === null : recorded.length === 1 ? proposals === null : repeats === null);
  const found = !checkId && recorded.length === 1 && proposals !== null && proposals.length > 0;
  const none = !checkId && recorded.length === 1 && proposals?.length === 0;
  const recordable = !created && (recorded.length === 0 || (found && checking));
  const number = recorded.length + 1;
  const consoleRequired = info.data?.consoleRequired ?? false;
  const ps5Ip = settings.data?.ps5Ip;
  const startBlocked = consoleRequired && ps5Ip === null;
  const consoleChip = CONSOLE_CHIPS[consoleState(ps5Ip, state, connected, !consoleRequired)];
  const seconds = active ? recordingSeconds(active, now) : null;
  const shownProblem = problem ?? (startBlocked && recordable && !active ? CONSOLE_MISSING : null);
  const title = checkId ? 'Check the reference' : 'Record the reference';
  const lede = checkId
    ? 'One recording of the demonstration shows whether the stored reference still matches the game.'
    : 'The game shows a demonstration before every run. GT7 Tutor records it once and finds the demonstration by itself.';

  const slots: Slot[] = Array.from({ length: count }, (_, index) => {
    const done = recorded[index];
    if (done) return { note: doneNote(done), state: 'done' };
    const state = index === recorded.length && !created && !none && !waiting ? 'now' : null;
    if (index === 0) return { note: checkId ? 'to record' : 'needed', state };
    return { note: created ? 'not needed' : 'optional, a check', state };
  });

  const errorLine = shownProblem ? <SetupProblem text={shownProblem} /> : null;

  const stageBody = (): ReactNode => {
    if (created) {
      return (
        <div className="record-message">
          <h2 className="record-done">The reference is active</h2>
          <p>Next: drive attempts. The Drive screen shows the cues, and a voice device also says them.</p>
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
    if (active && seconds !== null) {
      return (
        <div className="record-live">
          <div className="record-count" role="timer">
            {seconds}
          </div>
          {wide ? (
            <p className="record-line">
              <span className="record-dot" aria-hidden="true" />
              <span>Recording, {seconds} s. Stop when the demonstration has ended.</span>
            </p>
          ) : (
            <>
              <p className="record-line">
                <span className="record-dot" aria-hidden="true" />
                <span>Recording, {seconds} s</span>
              </p>
              <p className="record-note">Stop when the demonstration has ended.</p>
            </>
          )}
          {errorLine}
          {wide ? (
            <button className="stage-button light" type="button" onClick={() => void stop()} disabled={busy}>
              Stop recording {number}
            </button>
          ) : null}
        </div>
      );
    }
    if (waiting) {
      return (
        <div className="record-message">
          <h2>The recording is done</h2>
          {errorLine}
          {finishFailed ? (
            <button className="stage-button primary" type="button" onClick={() => void retry()} disabled={busy}>
              Try again
            </button>
          ) : null}
        </div>
      );
    }
    if (checkId && checkResult) {
      return (
        <div className="record-message">
          <h2>The recording is done</h2>
          <p className={`notice${checkResult.matched ? '' : ' bad'}`} role="status">
            {checkText(checkResult)}
          </p>
          <div className="record-actions">
            <Link to={paths.exercise(exerciseId)} className="stage-button primary">
              Back to the exercise
            </Link>
          </div>
        </div>
      );
    }
    if (none) {
      return (
        <div className="record-message">
          <h2>No complete demonstration found</h2>
          <p>
            Recording 1 does not hold the whole demonstration. Record again and let the demonstration play to the end, or set the range by hand.
          </p>
          <button className="stage-button primary" type="button" onClick={recordAgain}>
            Record again
          </button>
        </div>
      );
    }
    if (repeats && chosen) {
      const repeated = repeats.some(candidate => sameRun(candidate, chosen));
      return (
        <div className="record-message">
          <h2>The demonstration is found</h2>
          <p className={`notice${repeated ? '' : ' bad'}`} role="status">
            {repeated ? 'The same part repeats in both recordings.' : 'The recordings do not show the same part. Use recording 1, or record again.'}
          </p>
          {errorLine}
          <div className="record-actions">
            <button className="stage-button primary" type="button" onClick={() => void createFromChosen()} disabled={busy}>
              Use this as the reference
            </button>
            {repeated ? null : (
              <button className="stage-button" type="button" onClick={recordAgain}>
                Record again
              </button>
            )}
          </div>
        </div>
      );
    }
    if (found && proposals && !checking) {
      const choose = needsSelection(proposals);
      return (
        <div className="record-message">
          <h2>{choose ? 'Select the demonstration' : 'The demonstration is found'}</h2>
          {choose ? (
            <>
              <p>Recording 1 holds more than one demonstration. Select one. Use it as the reference, or record once more to check that the same part repeats.</p>
              <RunChoice proposals={proposals} selected={selected} onSelect={setSelected} />
            </>
          ) : (
            <p>{foundText(proposals[0]!)}</p>
          )}
          {errorLine}
          <div className="record-actions">
            <button className="stage-button primary" type="button" onClick={() => void createFromChosen()} disabled={busy || chosen === null}>
              Use this as the reference
            </button>
            <button className="stage-button" type="button" onClick={() => setChecking(true)} disabled={busy || chosen === null}>
              Record again to check
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="record-message">
        <h2>{wide ? 'In GT7, open the exercise and stay on the screen before the demonstration.' : 'Open the exercise in GT7 and stay on the screen before the demonstration.'}</h2>
        <p>{IDLE_HINT}</p>
        {errorLine}
        {wide ? (
          <button className="stage-button primary" type="button" onClick={() => void start()} disabled={busy || startBlocked}>
            Start recording
          </button>
        ) : null}
      </div>
    );
  };

  const phoneAction = (): ReactNode => {
    if (active) {
      return (
        <button className="stage-button light wide" type="button" onClick={() => void stop()} disabled={busy}>
          Stop recording {number}
        </button>
      );
    }
    if (!recordable) return null;
    return (
      <button className="stage-button primary wide" type="button" onClick={() => void start()} disabled={busy || startBlocked}>
        Start recording
      </button>
    );
  };

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
              </ul>
            </div>
            <Link to={paths.exercise(exerciseId)} className="stage-button">
              Close
            </Link>
          </div>
          <Slots slots={slots} />
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
      </ul>
      <div className="record-cols">
        <div className="record-stage">
          <Slots slots={slots} />
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
