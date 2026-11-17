import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CaptureInfo, ReferenceCheckResult, ReferenceProposal, StartKindName } from '@gt7/contracts';
import { api, ApiError } from '../../api/client.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { ExerciseHeader } from '../exercise/ExerciseHeader.tsx';
import { useExercise } from '../exercise/use-exercise.ts';
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

function Countdown({ active }: { active: Active }) {
  const now = useNow(true);
  const remaining = active.delayS - (now - active.startedAt) / 1000;
  const started = remaining <= 0;
  return (
    <div className={`countdown${started ? ' go' : ''}`} role="timer" aria-live="assertive">
      {started ? 'START' : Math.ceil(remaining)}
    </div>
  );
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
  if (error instanceof ApiError && error.code === 'console-address-missing') return 'Enter the PS5 address in Setup first.';
  if (error instanceof ApiError && error.code === 'busy') return 'Another capture or training is active. Stop it first.';
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

  if (proposals.length === 0) {
    return (
      <div className="notice bad" role="alert">
        No range repeats in the recordings. Record again, or set the range by hand.
      </div>
    );
  }
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

export function RecordView({ exerciseId }: { exerciseId: string }) {
  const exercise = useExercise(exerciseId);
  const { search } = useRouter();
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
  useRunningCapture(exerciseId, active, setActive);

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

  const retry = () => run(() => finish(recorded));

  if (exercise.error) return <p className="error">{errorText(exercise.error)}</p>;
  if (!exercise.data) return <p className="sub">Reading the exercise…</p>;
  const finished = recorded.length >= delays.length;
  const number = recorded.length + 1;
  return (
    <section>
      <ExerciseHeader exercise={exercise.data} title={checkId ? 'Check the reference' : 'Record the reference'} />
      <div className="cols">
        <div className="panel">
          <p className="lede">
            {checkId
              ? 'One recording of the demonstration shows whether the stored reference still matches the game.'
              : 'The game shows the same demonstration on every run, while the background differs. Three recordings with different waits let GT7 Tutor find the demonstration.'}
          </p>
          <ol className="recordings">
            {delays.map((delay, index) => (
              <li key={delay} className={index < recorded.length ? 'done' : index === recorded.length && !finished ? 'now' : undefined}>
                Recording {index + 1}: START after {delay} s{index < recorded.length ? `, ${recorded[index]!.packets} packets` : ''}
              </li>
            ))}
          </ol>
          {active ? (
            <div className="recording-live">
              <p>
                Recording {number} of {delays.length}. Start the demonstration in the game when you see START.
              </p>
              <Countdown active={active} />
              <p className="sub">Stop when the demonstration has ended.</p>
              <button className="btn" type="button" onClick={() => void stop()} disabled={busy}>
                Stop recording
              </button>
            </div>
          ) : !finished ? (
            <>
              <p className="sub">Open the exercise in GT7 and wait on the screen before the demonstration. Then start the recording here.</p>
              <button className="btn" type="button" onClick={() => void start()} disabled={busy}>
                Start recording {number} of {delays.length}
              </button>
            </>
          ) : null}
          {problem ? (
            <p className="error" role="alert">
              {problem}
              {problem.includes('Setup') ? (
                <>
                  {' '}
                  <Link to={paths.setup()}>Open Setup</Link>
                </>
              ) : null}
            </p>
          ) : null}
          {finishFailed ? (
            <button className="btn" type="button" onClick={() => void retry()} disabled={busy}>
              Try again
            </button>
          ) : null}
          {checkResult ? (
            <div className={`notice${checkResult.matched ? '' : ' bad'}`} role="status">
              {checkText(checkResult)}
            </div>
          ) : null}
          {created ? (
            <div className="notice" role="status">
              The reference is active. <Link to={paths.cues(exerciseId)}>See what the voice will say</Link> or{' '}
              <Link to={paths.now()}>go to the next step</Link>.
            </div>
          ) : null}
          {!checkId && !manual && !created ? (
            <button className="btn ghost" type="button" onClick={() => setManual(true)}>
              Set the range by hand
            </button>
          ) : null}
        </div>
        <div>
          {proposals && !created ? <Proposal exerciseId={exerciseId} captures={recorded} proposals={proposals} onCreated={() => setCreated(true)} /> : null}
          {manual && !created ? <ManualRange exerciseId={exerciseId} onCreated={() => setCreated(true)} /> : null}
        </div>
      </div>
    </section>
  );
}
