import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { CaptureInfo, ReferenceCheckResult, ReferenceProposal } from '@gt7/contracts';
import { api, ApiError } from '../../api/client.ts';
import { useLiveState } from '../../api/live.tsx';
import { useTrainingGate } from '../../app/use-training.ts';
import { useImmersive } from '../../app/immersive.tsx';
import { useWideLayout } from '../../app/layout.ts';
import { LoadProblem } from '../../app/NotFound.tsx';
import { formatTime } from '../../app/format.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { consoleState, type ConsoleState, type Status } from '../../app/status.ts';
import { DriveAction } from '../drive/DriveButton.tsx';
import { useExercise } from '../exercise/use-exercise.ts';
import { formatLocale, t } from '../../app/i18n.ts';
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

type StageProblem = { text: string; setupLink: boolean };

function consoleMissing(): StageProblem {
  return { text: t('record.console-missing'), setupLink: true };
}

function stageProblem(error: unknown): StageProblem {
  if (error instanceof ApiError && error.code === 'console-address-missing') return consoleMissing();
  return { text: problemText(error), setupLink: false };
}

function problemText(error: unknown): string {
  if (error instanceof ApiError && error.code === 'console-address-missing') return t('record.console-missing');
  if (error instanceof ApiError && error.code === 'busy') return t('record.busy');
  if (error instanceof ApiError && error.code === 'no-timer-run') {
    return t('record.no-timer-run');
  }
  return errorText(error);
}

function runLabel(proposal: ReferenceProposal): string {
  const range = proposal.ranges[0]!;
  return t('record.run-label', { time: formatTime(proposal.timeMs), first: range.first, last: range.last });
}

function foundText(proposal: ReferenceProposal): string {
  const range = proposal.ranges[0]!;
  return t('record.found.text', { time: formatTime(proposal.timeMs), first: range.first, last: range.last });
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
    <fieldset className="choice" role="radiogroup">
      <legend>{t('record.select.legend')}</legend>
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
    if (!chosen) return setProblem(t('record.manual.no-recording'));
    if (!Number.isInteger(firstFrame) || !Number.isInteger(lastFrame) || first === '' || last === '' || firstFrame < 0 || lastFrame < firstFrame) {
      return setProblem(t('record.manual.bad-frames'));
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
    <form className="panel manual" onSubmit={submit} noValidate>
      <h2>{t('record.manual.title')}</h2>
      <p className="sub">{t('record.manual.text')}</p>
      <p className="sub">{t('record.manual.keeps')}</p>
      <div className="field">
        <label htmlFor="manual-capture">{t('record.manual.recording')}</label>
        <select id="manual-capture" value={chosen} onChange={event => setCaptureId(event.target.value)}>
          {usable.map(capture => (
            <option key={capture.id} value={capture.id}>
              {t(capture.purpose === 'demo' ? 'record.manual.demo-option' : 'record.manual.own-option', { date: new Date(capture.startedAt).toLocaleString(formatLocale()), count: capture.packets })}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="manual-first">{t('record.manual.first')}</label>
          <input id="manual-first" inputMode="numeric" value={first} onChange={event => setFirst(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="manual-last">{t('record.manual.last')}</label>
          <input id="manual-last" inputMode="numeric" value={last} onChange={event => setLast(event.target.value)} />
        </div>
      </div>
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
      <button className="btn" type="submit">
        {t('record.manual.create')}
      </button>
    </form>
  );
}

function checkText(result: ReferenceCheckResult): string {
  return result.matched ? t('record.check.matched') : t('record.check.not-matched');
}

const CONSOLE_TONES: Record<ConsoleState, Status['tone']> = { 'recorded-data': 'on', 'no-address': 'off', receiving: 'on', 'address-saved': 'idle' };

function captureSeconds(capture: CaptureInfo): number | null {
  if (!capture.endedAt) return null;
  return Math.max(1, Math.round((Date.parse(capture.endedAt) - Date.parse(capture.startedAt)) / 1000));
}

function doneNote(capture: CaptureInfo): string {
  const seconds = captureSeconds(capture);
  return seconds === null ? t('record.slot.done') : t('record.slot.done-seconds', { seconds });
}

type Slot = { note: string; state: 'done' | 'now' | null };

function Slots({ slots }: { slots: Slot[] }) {
  return (
    <ol className="record-slots">
      {slots.map((slot, index) => (
        <li key={index} className={slot.state ?? undefined} aria-current={slot.state === 'now' ? 'step' : undefined}>
          <b>{t('record.slot.title', { number: index + 1 })}</b>
          <span>{slot.note}</span>
        </li>
      ))}
    </ol>
  );
}

function SetupProblem({ problem }: { problem: StageProblem }) {
  return (
    <p className="error" role="alert">
      {problem.text}
      {problem.setupLink ? (
        <>
          {' '}
          <Link to={paths.setup('console')}>{t('record.open-setup')}</Link>
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
          <h2>{t('record.side.title')}</h2>
          <p>{t('record.side.text')}</p>
        </div>
      )}
      {check || manualOpen ? null : <ManualHint onManual={onManual} />}
    </aside>
  );
}

function ManualHint({ onManual }: { onManual(): void }) {
  return (
    <p className="record-manual-hint">
      <span>{t('record.manual-hint.question')}</span>{' '}
      <button type="button" className="text-link" onClick={onManual}>
        {t('record.manual-hint.link')}
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
  const gate = useTrainingGate('record');
  const [problem, setProblem] = useState<StageProblem | null>(null);
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
      setProblem(stageProblem(error));
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      await gate.before();
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
  if (!exercise.data) return <p className="sub">{t('record.reading')}</p>;
  const count = checkId ? 1 : 2;
  const waiting = recorded.length > 0 && (checkId ? checkResult === null : recorded.length === 1 ? proposals === null : repeats === null);
  const found = !checkId && recorded.length === 1 && proposals !== null && proposals.length > 0;
  const none = !checkId && recorded.length === 1 && proposals?.length === 0;
  const recordable = !created && (recorded.length === 0 || (found && checking));
  const number = recorded.length + 1;
  const consoleRequired = info.data?.consoleRequired ?? false;
  const ps5Ip = settings.data?.ps5Ip;
  const startBlocked = consoleRequired && ps5Ip === null;
  const chipState = consoleState(ps5Ip, state, connected, !consoleRequired);
  const consoleChip: Status = { tone: CONSOLE_TONES[chipState], text: t(`record.chip.${chipState}`) };
  const seconds = active ? recordingSeconds(active, now) : null;
  const shownProblem = problem ?? (startBlocked && recordable && !active ? consoleMissing() : null);
  const title = checkId ? t('record.title.check') : t('record.title.record');
  const lede = checkId ? t('record.lede.check') : t('record.lede.record');

  const slots: Slot[] = Array.from({ length: count }, (_, index) => {
    const done = recorded[index];
    if (done) return { note: doneNote(done), state: 'done' };
    const state = index === recorded.length && !created && !none && !waiting ? 'now' : null;
    if (index === 0) return { note: checkId ? t('record.slot.to-record') : t('record.slot.needed'), state };
    return { note: created ? t('record.slot.not-needed') : t('record.slot.optional'), state };
  });

  const errorLine = shownProblem ? <SetupProblem problem={shownProblem} /> : null;

  const stageBody = (): ReactNode => {
    if (created) {
      return (
        <div className="record-message">
          <h2 className="record-done">{t('record.created.title')}</h2>
          <p>{t('record.created.text')}</p>
          <div className="record-actions">
            <DriveAction exerciseId={exerciseId} referenceId={null} className="stage-button primary" problemClass="stage-alert">
              {t('record.drive')}
            </DriveAction>
            <Link to={paths.cues(exerciseId)} className="stage-button">
              {t('record.hear-cues')}
            </Link>
          </div>
        </div>
      );
    }
    if (active && seconds !== null) {
      return (
        <div className="record-live">
          <div className="record-count">
            {seconds}
          </div>
          {wide ? (
            <p className="record-line">
              <span className="record-dot" />
              <span>{t('record.live.line-wide', { seconds })}</span>
            </p>
          ) : (
            <>
              <p className="record-line">
                <span className="record-dot" />
                <span>{t('record.live.line', { seconds })}</span>
              </p>
              <p className="record-note">{t('record.live.note')}</p>
            </>
          )}
          {errorLine}
          {wide ? (
            <button className="stage-button light" type="button" onClick={() => void stop()} disabled={busy}>
              {t('record.stop', { number })}
            </button>
          ) : null}
        </div>
      );
    }
    if (waiting) {
      return (
        <div className="record-message">
          <h2>{t('record.done.title')}</h2>
          {errorLine}
          {finishFailed ? (
            <button className="stage-button primary" type="button" onClick={() => void retry()} disabled={busy}>
              {t('record.try-again')}
            </button>
          ) : null}
        </div>
      );
    }
    if (checkId && checkResult) {
      return (
        <div className="record-message">
          <h2>{t('record.done.title')}</h2>
          <p className={`notice${checkResult.matched ? '' : ' bad'}`} role="status">
            {checkText(checkResult)}
          </p>
          <div className="record-actions">
            <DriveAction exerciseId={exerciseId} referenceId={null} className="stage-button primary" problemClass="stage-alert">
              {t('record.drive')}
            </DriveAction>
          </div>
        </div>
      );
    }
    if (none) {
      return (
        <div className="record-message">
          <h2>{t('record.none.title')}</h2>
          <p>{t('record.none.text')}</p>
          <button className="stage-button primary" type="button" onClick={recordAgain}>
            {t('record.again')}
          </button>
        </div>
      );
    }
    if (repeats && chosen) {
      const repeated = repeats.some(candidate => sameRun(candidate, chosen));
      return (
        <div className="record-message">
          <h2>{t('record.found.title')}</h2>
          <p className={`notice${repeated ? '' : ' bad'}`} role="status">
            {repeated ? t('record.repeats.same') : t('record.repeats.different')}
          </p>
          {errorLine}
          <div className="record-actions">
            <button className="stage-button primary" type="button" onClick={() => void createFromChosen()} disabled={busy}>
              {t('record.use')}
            </button>
            {repeated ? null : (
              <button className="stage-button" type="button" onClick={recordAgain}>
                {t('record.again')}
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
          <h2>{choose ? t('record.select.title') : t('record.found.title')}</h2>
          {choose ? (
            <>
              <p>{t('record.select.text')}</p>
              <RunChoice proposals={proposals} selected={selected} onSelect={setSelected} />
            </>
          ) : (
            <p>{foundText(proposals[0]!)}</p>
          )}
          {errorLine}
          <div className="record-actions">
            <button className="stage-button primary" type="button" onClick={() => void createFromChosen()} disabled={busy || chosen === null}>
              {t('record.use')}
            </button>
            <button className="stage-button" type="button" onClick={() => setChecking(true)} disabled={busy || chosen === null}>
              {t('record.again-check')}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="record-message">
        <h2>{wide ? t('record.idle.title-wide') : t('record.idle.title')}</h2>
        <p>{t('record.idle.hint')}</p>
        {errorLine}
        {gate.notice ? <p className="notice">{gate.notice}</p> : null}
        {wide ? (
          <button className="stage-button primary" type="button" onClick={() => void start()} disabled={busy || startBlocked || gate.blocked}>
            {gate.label(t('record.start'))}
          </button>
        ) : null}
      </div>
    );
  };

  const phoneAction = (): ReactNode => {
    if (active) {
      return (
        <button className="stage-button light wide" type="button" onClick={() => void stop()} disabled={busy}>
          {t('record.stop', { number })}
        </button>
      );
    }
    if (!recordable) return null;
    return (
      <button className="stage-button primary wide" type="button" onClick={() => void start()} disabled={busy || startBlocked || gate.blocked}>
        {gate.label(t('record.start'))}
      </button>
    );
  };

  if (!wide) {
    return (
      <section className="record-phone">
        <div className="record-stage">
          <div className="record-top">
            <div>
              <p>
                {t(checkId ? 'record.phone.check' : 'record.phone.reference', { name: exercise.data.name })}
              </p>
              <ul className="record-dots">
                <li title={consoleChip.text}>
                  <span className={`dot ${consoleChip.tone}`} />
                  {consoleRequired ? t('record.telemetry') : t('record.recorded-data')}
                </li>
              </ul>
            </div>
            <Link to={paths.exercise(exerciseId)} className="stage-button">
              {t('common.close')}
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
      <nav className="breadcrumb">
        <Link to={paths.exercises()}>{t('record.breadcrumb.exercises')}</Link> / <Link to={paths.exercise(exerciseId)}>{exercise.data.name}</Link> / {t('record.breadcrumb.reference')}
      </nav>
      <h1>{title}</h1>
      <p className="lede">{lede}</p>
      <div className="record-cols">
        <div className="record-stage">
          <Slots slots={slots} />
          <div className="record-body">{stageBody()}</div>
          {active ? (
            <button type="button" className="text-link record-cancel" onClick={() => void cancel()} disabled={busy}>
              {t('record.cancel')}
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
