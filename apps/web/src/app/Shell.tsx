import { useEffect, useState, type ReactNode } from 'react';
import type { Exercise, MessageKey } from '@gt7/contracts';
import { api } from '../api/client.ts';
import { useLiveConnection, useLiveState } from '../api/live.tsx';
import { currentExercise, liveExerciseId, onCurrentExerciseChanged, onExercisesChanged, rememberExercise } from './current-exercise.ts';
import { DemoLabel, useDemo } from './demo.tsx';
import { Icon, type IconName } from './icons.tsx';
import { ImmersiveContext } from './immersive.tsx';
import { useWideLayout } from './layout.ts';
import { Logo } from './Logo.tsx';
import { ProfileMenu } from './ProfileMenu.tsx';
import { Link, paths, useRouter, type Route } from './router.tsx';
import { RunningCapture } from './RunningCapture.tsx';
import { RunningRace } from './RunningRace.tsx';
import { RunningTraining } from './RunningTraining.tsx';
import { TrainingNameContext } from './use-training.ts';
import { useSession } from './session.tsx';
import { statusLabel, telemetryStatus, voiceStatus, type Status } from './status.ts';
import { Views } from './Views.tsx';
import { exerciseTitle } from '../features/exercise/use-exercise-where.ts';
import { t } from './i18n.ts';

type NavItem = { label: MessageKey; to: string; icon: IconName; matches(route: Route): boolean };

const EXERCISE_ROUTES: Route['name'][] = ['exercises', 'exercises-redirect', 'cues', 'references', 'record', 'attempts', 'drive', 'review'];

const EXERCISES: NavItem = { label: 'app.nav.exercises', to: paths.exercises(), icon: 'list', matches: route => EXERCISE_ROUTES.includes(route.name) };
const RACE_ROUTES: Route['name'][] = ['races', 'race-record', 'race'];

const RACES: NavItem = { label: 'app.nav.races', to: paths.races(), icon: 'flag', matches: route => RACE_ROUTES.includes(route.name) };
const SETUP: NavItem = { label: 'app.nav.setup', to: paths.setup(), icon: 'gear', matches: route => route.name === 'setup' || route.name === 'delete-history' };
const ITEMS = [EXERCISES, RACES, SETUP];

export function StatusDot({ status }: { status: Status }) {
  return <span className={`dot ${status.tone}`} />;
}

function useCurrentExercise(enabled: boolean): Exercise | null {
  const { user } = useSession();
  const liveId = useLiveState(({ state }) => liveExerciseId(state));
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
  const { deviceId } = useLiveConnection();
  const demo = useDemo() !== null;
  const telemetry = useLiveState(({ state, connected }) => telemetryStatus(state, connected, demo));
  const voice = useLiveState(({ state }) => voiceStatus(state, deviceId));
  return (
    <div className="status-links">
      <Link to={paths.setup('console')} className="status-link" title={statusLabel(t('app.status.console'), telemetry)}>
        <StatusDot status={telemetry} />
        {t('app.status.console')}
      </Link>
      <Link to={paths.setup('voice')} className="status-link" title={statusLabel(t('app.status.voice'), voice)}>
        <StatusDot status={voice} />
        {t('app.status.voice')}
      </Link>
    </div>
  );
}

function Navigation({ placement, items }: { placement: 'top' | 'bottom'; items: NavItem[] }) {
  const { route } = useRouter();
  return (
    <nav className="nav" data-placement={placement}>
      {items.map(item => (
        <Link key={item.label} to={item.to} current={item.matches(route)}>
          {placement === 'bottom' ? <Icon name={item.icon} /> : null}
          {t(item.label)}
        </Link>
      ))}
    </nav>
  );
}

function ImmersiveDemoLabel() {
  if (!useDemo()) return null;
  return (
    <p className="immersive-demo-label">
      {t('app.demo.short')}
    </p>
  );
}

function useTrainingName(exercise: Exercise | null): string | null {
  const liveId = useLiveState(({ state }) => liveExerciseId(state));
  return exercise && liveId !== null && exercise.id === liveId ? exerciseTitle(exercise).title : null;
}

export function Shell({ children }: { children?: ReactNode }) {
  const wide = useWideLayout();
  const training = useLiveState(({ state }) => liveExerciseId(state) !== null);
  const exercise = useCurrentExercise(training);
  const trainingName = useTrainingName(exercise);
  const [immersive, setImmersive] = useState(false);
  return (
    <TrainingNameContext.Provider value={trainingName}>
      {immersive ? (
        <ImmersiveDemoLabel />
      ) : (
        <header className="app-header">
          <Link to={paths.exercises()} className="brand">
            <Logo height={wide ? 32 : 26} />
          </Link>
          {wide ? <Navigation placement="top" items={ITEMS} /> : null}
          <div className="header-end">
            <StatusLinks />
            <ProfileMenu />
          </div>
        </header>
      )}
      {immersive ? null : <DemoLabel />}
      {immersive ? null : <RunningCapture />}
      {immersive ? null : <RunningTraining />}
      {immersive ? null : <RunningRace />}
      <main className={immersive ? 'view immersive' : 'view'}>
        <ImmersiveContext.Provider value={setImmersive}>{children ?? <Views />}</ImmersiveContext.Provider>
      </main>
      {wide || immersive ? null : <Navigation placement="bottom" items={ITEMS} />}
    </TrainingNameContext.Provider>
  );
}
