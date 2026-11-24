import { useState, type ReactNode } from 'react';
import type { MessageKey } from '@gt7/contracts';
import { useLiveConnection, useLiveState } from '../../api/live.tsx';
import { IconButton } from '../../app/IconButton.tsx';
import { t } from '../../app/i18n.ts';
import { Link, paths } from '../../app/router.tsx';
import { useSession } from '../../app/session.tsx';
import { readStored, writeStored } from '../../app/storage.ts';
import { useVoiceClaim } from '../../voice/use-voice-claim.ts';
import { ConsoleForm } from '../setup/ConsoleForm.tsx';
import './get-ready.css';

type StepState = 'done' | 'now' | 'later';

type ConsoleState = 'missing' | 'silent' | 'receiving';

const CONSOLE_SUMMARY: Record<ConsoleState, MessageKey | null> = {
  missing: null,
  silent: 'app.get-ready.console.silent',
  receiving: 'app.get-ready.console.receiving'
};

function consoleSummary(state: ConsoleState): string | null {
  const key = CONSOLE_SUMMARY[state];
  return key ? t(key) : null;
}

function voiceLaterKey(userId: string): string {
  return `gt7.getReady.voiceLater.${userId}`;
}

function storedVoiceLater(userId: string): boolean {
  return readStored(voiceLaterKey(userId)) === '1';
}

function storeVoiceLater(userId: string): void {
  writeStored(voiceLaterKey(userId), '1');
}

type StepProps = { number: number; title: string; state: StepState; summary: string | null; action?: ReactNode; children: ReactNode };

function Step({ number, title, state, summary, action, children }: StepProps) {
  return (
    <li className={`ready-step ${state}`} aria-current={state === 'now' ? 'step' : undefined}>
      <div className="ready-step-head">
        <span className="ready-step-mark">
          {state === 'done' ? '✓' : number}
        </span>
        <h2>{title}</h2>
        {summary ? <span className="ready-step-summary">{summary}</span> : null}
        {action}
      </div>
      {state === 'now' ? <div className="ready-step-body">{children}</div> : null}
    </li>
  );
}

function VoiceStep({ onLater }: { onLater(): void }) {
  const voice = useVoiceClaim();
  return (
    <>
      <p>{t('app.get-ready.voice.text')}</p>
      <div className="ready-actions">
        <button type="button" className="btn" disabled={voice.busy} onClick={() => void voice.claim()}>
          {t('app.get-ready.voice.use')}
        </button>
        <button type="button" className="btn ghost" onClick={onLater}>
          {t('app.get-ready.voice.later')}
        </button>
      </div>
      {voice.problem ? (
        <p className="error" role="alert">
          {voice.problem}
        </p>
      ) : null}
    </>
  );
}

function VoiceTest() {
  const { player } = useLiveConnection();
  const [problem, setProblem] = useState<string | null>(null);
  const run = async () => {
    setProblem(null);
    try {
      await player.test();
    } catch {
      setProblem(t('app.get-ready.voice.test-failed'));
    }
  };
  return (
    <>
      <IconButton icon="speaker" label={t('app.get-ready.voice.test')} onClick={() => void run()} />
      {problem ? (
        <p className="error ready-step-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </>
  );
}

export function GetReady({ exerciseCount, onOpenExercises }: { exerciseCount: number; onOpenExercises(): void }) {
  const { user } = useSession();
  const { deviceId } = useLiveConnection();
  const { state } = useLiveState(snapshot => snapshot);
  const [consoleState, setConsoleState] = useState<ConsoleState>('missing');
  const [voiceLater, setVoiceLater] = useState(() => storedVoiceLater(user.id));

  const holder = state?.voiceDeviceId ?? null;
  const voiceHere = holder === deviceId && state?.voiceReady === true;
  const voiceElsewhere = holder !== null && holder !== deviceId;
  const consoleDone = consoleState !== 'missing';
  const voiceDone = voiceHere || voiceElsewhere;
  const voiceSettled = voiceDone || voiceLater;
  const exerciseDone = exerciseCount > 0;
  const readyCount = [consoleDone, voiceDone, exerciseDone].filter(Boolean).length;

  const current = !consoleDone ? 1 : !voiceSettled ? 2 : !exerciseDone ? 3 : null;
  const stateOf = (step: number, done: boolean): StepState => (done ? 'done' : step === current ? 'now' : 'later');

  const later = () => {
    storeVoiceLater(user.id);
    setVoiceLater(true);
  };

  const voiceSummary = voiceHere ? t('app.get-ready.voice.this-device') : voiceElsewhere ? t('app.get-ready.voice.another-device') : voiceLater ? t('app.get-ready.voice.later-summary') : null;

  return (
    <section className="get-ready">
      <p className="sub get-ready-welcome">{t('app.get-ready.welcome', { name: user.name })}</p>
      <h1>{t('app.get-ready.title')}</h1>
      <p className="lede">{t('app.get-ready.text')}</p>
      <div className="ready-progress">
        <div className="ready-bar">
          <span style={{ width: `${(readyCount / 3) * 100}%` }} />
        </div>
        <b>{t('app.get-ready.progress', { done: readyCount })}</b>
      </div>
      <ol className="ready-steps">
        <Step
          number={1}
          title={t('app.get-ready.console.title')}
          state={stateOf(1, consoleDone)}
          summary={consoleSummary(consoleState)}
        >
          <p>{t('app.get-ready.console.text')}</p>
          <ConsoleForm layout="inline" onChecked={receiving => setConsoleState(receiving ? 'receiving' : 'silent')} />
        </Step>
        <Step
          number={2}
          title={t('app.get-ready.voice.title')}
          state={stateOf(2, voiceDone)}
          summary={voiceSummary}
          action={voiceHere ? <VoiceTest /> : null}
        >
          <VoiceStep onLater={later} />
        </Step>
        <Step
          number={3}
          title={t('app.get-ready.exercise.title')}
          state={stateOf(3, exerciseDone)}
          summary={exerciseDone ? t('app.get-ready.exercise.done') : null}
          action={
            exerciseDone ? (
              <Link to={paths.exercises()} className="btn inline ready-step-open" onNavigate={onOpenExercises}>
                {t('app.get-ready.exercise.open')}
              </Link>
            ) : null
          }
        >
          <p>{t('app.get-ready.exercise.text')}</p>
          <div className="ready-actions">
            <Link to={paths.exercises()} className="btn yellow" onNavigate={onOpenExercises}>
              {t('app.get-ready.exercise.add')}
            </Link>
          </div>
        </Step>
      </ol>
      <p className="sub">{t('app.get-ready.footer')}</p>
    </section>
  );
}
