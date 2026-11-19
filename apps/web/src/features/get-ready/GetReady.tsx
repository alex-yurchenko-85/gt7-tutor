import { useState, type ReactNode } from 'react';
import { useLiveConnection, useLiveState } from '../../api/live.tsx';
import { IconButton } from '../../app/IconButton.tsx';
import { Link, paths } from '../../app/router.tsx';
import { useSession } from '../../app/session.tsx';
import { readStored, writeStored } from '../../app/storage.ts';
import { useVoiceClaim } from '../../voice/use-voice-claim.ts';
import { ConsoleForm } from '../setup/ConsoleForm.tsx';
import './get-ready.css';

type StepState = 'done' | 'now' | 'later';

type ConsoleState = 'missing' | 'saved' | 'silent' | 'receiving';

const CONSOLE_SUMMARY: Record<ConsoleState, string | null> = {
  missing: null,
  saved: 'Address saved',
  silent: 'Address saved, no telemetry yet',
  receiving: 'Receiving telemetry'
};

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
  const id = `get-ready-step-${number}`;
  return (
    <li className={`ready-step ${state}`} aria-labelledby={id} aria-current={state === 'now' ? 'step' : undefined}>
      <div className="ready-step-head">
        <span className="ready-step-mark" aria-hidden="true">
          {state === 'done' ? '✓' : number}
        </span>
        <h2 id={id}>{title}</h2>
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
      <p>One device plays the cues: this device, or another one with GT7 Tutor open. A phone must stay unlocked during an attempt.</p>
      <div className="ready-actions">
        <button type="button" className="btn" disabled={voice.busy} onClick={() => void voice.claim()}>
          Use this device for voice
        </button>
        <button type="button" className="btn ghost" onClick={onLater}>
          Set up the voice later
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
      setProblem('The test did not play. Select Use this device for voice in Setup.');
    }
  };
  return (
    <>
      <IconButton icon="speaker" label="Test" onClick={() => void run()} />
      {problem ? (
        <p className="error ready-step-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </>
  );
}

export function GetReady({ ps5Ip, exerciseCount }: { ps5Ip: string | null; exerciseCount: number }) {
  const { user } = useSession();
  const { deviceId } = useLiveConnection();
  const { state } = useLiveState(snapshot => snapshot);
  const [consoleState, setConsoleState] = useState<ConsoleState>(ps5Ip === null ? 'missing' : 'saved');
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

  const voiceSummary = voiceHere ? 'This device' : voiceElsewhere ? 'Another device' : voiceLater ? 'Later' : null;

  return (
    <section className="get-ready" aria-labelledby="get-ready-title">
      <p className="sub get-ready-welcome">Welcome, {user.name}</p>
      <h1 id="get-ready-title">Get ready to train</h1>
      <p className="lede">Three things, once. GT7 Tutor needs the console for telemetry and a device that plays the voice. Then pick your first exercise.</p>
      <div className="ready-progress">
        <div className="ready-bar" role="progressbar" aria-label="Ready" aria-valuemin={0} aria-valuemax={3} aria-valuenow={readyCount}>
          <span style={{ width: `${(readyCount / 3) * 100}%` }} />
        </div>
        <b>{readyCount} of 3 ready</b>
      </div>
      <ol className="ready-steps" aria-label="Three steps">
        <Step
          number={1}
          title="Connect the console"
          state={stateOf(1, consoleDone)}
          summary={CONSOLE_SUMMARY[consoleState]}
        >
          <p>On the PS5: Settings, Network, View Connection Status, IPv4 Address. Start GT7 so that the console sends telemetry.</p>
          <ConsoleForm layout="inline" onChecked={receiving => setConsoleState(receiving ? 'receiving' : 'silent')} />
        </Step>
        <Step
          number={2}
          title="Choose the device for the voice"
          state={stateOf(2, voiceDone)}
          summary={voiceSummary}
          action={voiceHere ? <VoiceTest /> : null}
        >
          <VoiceStep onLater={later} />
        </Step>
        <Step number={3} title="Pick your first exercise" state={stateOf(3, exerciseDone)} summary={exerciseDone ? 'Done' : null}>
          <p>
            A licence test, a Circuit Experience sector or a Brand Central exercise. GT7 Tutor then leads you through three steps: reference, attempts,
            review.
          </p>
          <div className="ready-actions">
            <Link to={paths.addExercise()} className="btn yellow">
              Add an exercise
            </Link>
          </div>
        </Step>
      </ol>
      <p className="sub">You can change all of this later in Setup. This page goes away when the three steps are done.</p>
    </section>
  );
}
