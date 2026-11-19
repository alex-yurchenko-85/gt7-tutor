import { useEffect, useState, type ReactNode } from 'react';
import type { Exercise } from '@gt7/contracts';
import { api } from '../api/client.ts';
import { useLive } from '../api/live.tsx';
import { currentExercise, liveExerciseId, onCurrentExerciseChanged, onExercisesChanged, rememberExercise } from './current-exercise.ts';
import { DEMO_LABEL, DemoLabel, useDemo } from './demo.tsx';
import { shortName } from './format.ts';
import { Icon, type IconName } from './icons.tsx';
import { ImmersiveContext } from './immersive.tsx';
import { useWideLayout } from './layout.ts';
import { Logo } from './Logo.tsx';
import { ProfileMenu } from './ProfileMenu.tsx';
import { Link, paths, useRouter, type Route } from './router.tsx';
import { RunningCapture } from './RunningCapture.tsx';
import { useSession } from './session.tsx';
import { telemetryStatus, voiceStatus, type Status } from './status.ts';
import { Views } from './Views.tsx';

type NavItem = { label: string; to: string; icon: IconName; matches(route: Route): boolean };

const EXERCISE_ROUTES: Route['name'][] = ['exercises', 'exercise', 'add-exercise', 'cues', 'references', 'record', 'attempts', 'review'];

const EXERCISES: NavItem = { label: 'Exercises', to: paths.exercises(), icon: 'list', matches: route => EXERCISE_ROUTES.includes(route.name) };
const DRIVE: NavItem = { label: 'Drive', to: paths.drive(), icon: 'drive', matches: route => route.name === 'drive' };
const SETUP: NavItem = { label: 'Setup', to: paths.setup(), icon: 'gear', matches: route => route.name === 'setup' || route.name === 'delete-history' };

export function StatusDot({ status }: { status: Status }) {
  return <span className={`dot ${status.tone}`} aria-hidden="true" />;
}

function useCurrentExercise(enabled: boolean): Exercise | null {
  const { user } = useSession();
  const { state } = useLive();
  const liveId = liveExerciseId(state);
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [version, setVersion] = useState(0);
  const [, setRemembered] = useState(0);
  useEffect(() => {
    if (liveId) rememberExercise(user.id, liveId);
  }, [liveId, user.id]);
  useEffect(() => onExercisesChanged(() => setVersion(value => value + 1)), []);
  useEffect(() => onCurrentExerciseChanged(() => setRemembered(value => value + 1)), []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    api.exercises().then(
      exercises => {
        if (active) setExercises(exercises);
      },
      () => undefined
    );
    return () => {
      active = false;
    };
  }, [enabled, user.id, version]);
  return exercises ? currentExercise(exercises, user.id, liveId) : null;
}

function StatusLinks() {
  const { state, connected, deviceId } = useLive();
  const telemetry = telemetryStatus(state, connected, useDemo() !== null);
  const voice = voiceStatus(state, deviceId);
  return (
    <div className="status-links" aria-live="polite">
      <Link to={paths.setup('console')} className="status-link" label={`Console: ${telemetry.text}. Open Setup`}>
        <StatusDot status={telemetry} />
        Console
      </Link>
      <Link to={paths.setup('voice')} className="status-link" label={`Voice: ${voice.text}. Open Setup`}>
        <StatusDot status={voice} />
        Voice
      </Link>
    </div>
  );
}

function Navigation({ placement, items }: { placement: 'top' | 'bottom'; items: NavItem[] }) {
  const { route } = useRouter();
  return (
    <nav className="nav" data-placement={placement} aria-label="Main">
      {items.map(item => (
        <Link key={item.label} to={item.to} current={item.matches(route)}>
          {placement === 'bottom' ? <Icon name={item.icon} /> : null}
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

function DriveButton({ exercise }: { exercise: Exercise | null }) {
  const { route } = useRouter();
  if (!exercise) return null;
  return (
    <Link to={paths.drive()} className="drive-button" current={route.name === 'drive'}>
      Drive <span className="drive-button-name">· {shortName(exercise.name)}</span>
    </Link>
  );
}

function ImmersiveDemoLabel() {
  if (!useDemo()) return null;
  return (
    <p className="immersive-demo-label" role="note" aria-label={DEMO_LABEL}>
      Demo
    </p>
  );
}

export function Shell({ children }: { children?: ReactNode }) {
  const wide = useWideLayout();
  const exercise = useCurrentExercise(wide);
  const [immersive, setImmersive] = useState(false);
  return (
    <>
      {immersive ? (
        <ImmersiveDemoLabel />
      ) : (
        <header className="app-header">
          <Link to={paths.exercises()} className="brand">
            <Logo height={wide ? 32 : 26} />
          </Link>
          {wide ? <Navigation placement="top" items={[EXERCISES, SETUP]} /> : null}
          <div className="header-end">
            <StatusLinks />
            {wide ? <DriveButton exercise={exercise} /> : null}
            <ProfileMenu />
          </div>
        </header>
      )}
      {immersive ? null : <DemoLabel />}
      {immersive ? null : <RunningCapture />}
      <main className={immersive ? 'view immersive' : 'view'}>
        <ImmersiveContext.Provider value={setImmersive}>{children ?? <Views />}</ImmersiveContext.Provider>
      </main>
      {wide || immersive ? null : <Navigation placement="bottom" items={[EXERCISES, DRIVE, SETUP]} />}
    </>
  );
}
