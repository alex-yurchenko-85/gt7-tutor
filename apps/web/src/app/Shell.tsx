import type { ReactNode } from 'react';
import { useLive } from '../api/live.tsx';
import { DemoLabel, useDemo } from './demo.tsx';
import { useWideLayout } from './layout.ts';
import { Link, paths, useRouter, type Route } from './router.tsx';
import { RunningCapture } from './RunningCapture.tsx';
import { telemetryStatus, voiceStatus, type Status } from './status.ts';
import { Views } from './Views.tsx';

type NavItem = { label: string; to: string; matches(route: Route): boolean };

const NAV: NavItem[] = [
  { label: 'Now', to: paths.now(), matches: route => ['now', 'cues', 'references', 'record', 'attempts', 'review'].includes(route.name) },
  { label: 'Catalogue', to: paths.catalogue(), matches: route => route.name === 'catalogue' },
  { label: 'Drive', to: paths.drive(), matches: route => route.name === 'drive' },
  { label: 'Progress', to: paths.progress(), matches: route => route.name === 'progress' },
  { label: 'Setup', to: paths.setup(), matches: route => route.name === 'setup' }
];

export function StatusDot({ status }: { status: Status }) {
  return <span className={`dot ${status.tone}`} aria-hidden="true" />;
}

function StatusLine() {
  const { state, connected, deviceId } = useLive();
  const telemetry = telemetryStatus(state, connected, useDemo() !== null);
  const voice = voiceStatus(state, deviceId);
  return (
    <div className="status-line" aria-live="polite">
      <span>
        <StatusDot status={telemetry} />
        {telemetry.text}
      </span>
      <span>
        <StatusDot status={voice} />
        {voice.text}
      </span>
    </div>
  );
}

function Navigation({ placement }: { placement: 'top' | 'bottom' }) {
  const { route } = useRouter();
  return (
    <nav className="nav" data-placement={placement} aria-label="Main">
      {NAV.map(item => (
        <Link key={item.label} to={item.to} current={item.matches(route)}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function Shell({ children }: { children?: ReactNode }) {
  const wide = useWideLayout();
  return (
    <>
      <header className="app-header">
        <Link to={paths.now()} className="brand">
          GT7 Tutor
        </Link>
        {wide ? <Navigation placement="top" /> : null}
        {wide ? <StatusLine /> : null}
      </header>
      <DemoLabel />
      <RunningCapture />
      <main className="view">{children ?? <Views />}</main>
      {wide ? null : <Navigation placement="bottom" />}
    </>
  );
}
