import { useEffect, useState, type ReactNode } from 'react';
import type { LiveState, Settings } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { useLive } from '../../api/live.tsx';
import { useDemo } from '../../app/demo.tsx';
import { useWideLayout } from '../../app/layout.ts';
import { useResource } from '../../app/resource.ts';
import { Link, paths, useRouter, type SetupSection } from '../../app/router.tsx';
import type { Status } from '../../app/status.ts';
import { CatalogueSection } from './CatalogueSection.tsx';
import { ConsoleSection, DemoConsoleSection } from './ConsoleSection.tsx';
import { DeleteHistoryView } from './DeleteHistoryView.tsx';
import { PreferencesSection } from './PreferenceSections.tsx';
import { ProfilesSection } from './ProfilesSection.tsx';
import { consoleReadiness, defaultSection, voiceReadiness } from './readiness.ts';
import { StorageSection } from './StorageSection.tsx';
import { VoiceSection } from './VoiceSection.tsx';
import './setup.css';

const SECTIONS: { id: SetupSection; label: string }[] = [
  { id: 'console', label: 'Console' },
  { id: 'voice', label: 'Voice' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'catalogue', label: 'Catalogue' },
  { id: 'data', label: 'Data' }
];

function isSection(value: string): value is SetupSection {
  return SECTIONS.some(section => section.id === value);
}

function useFirstSection(settings: Settings | null, failed: boolean, state: LiveState | null, demo: boolean): SetupSection | null {
  const [kept, setKept] = useState<SetupSection | null>(null);
  const candidate = settings ? defaultSection(settings.ps5Ip, demo, state?.voiceDeviceId ?? null) : failed ? 'console' : null;
  const known = settings !== null && state !== null;
  useEffect(() => {
    if (kept === null && known && candidate) setKept(candidate);
  }, [kept, known, candidate]);
  return kept ?? candidate;
}

export function ReadinessChip({ status }: { status: Status }) {
  return (
    <li className={`setup-chip${status.tone === 'off' ? ' bad' : ''}`}>
      <span className={`dot ${status.tone}`} aria-hidden="true" />
      {status.text}
    </li>
  );
}

export function SetupView() {
  const demo = useDemo() !== null;
  const wide = useWideLayout();
  const { hash, route } = useRouter();
  const deleting = route.name === 'delete-history';
  const settings = useResource(() => api.settings(), []);
  const { state, connected, deviceId } = useLive();
  const consoleStatus = consoleReadiness(settings.data?.ps5Ip ?? null, state, connected, demo);
  const voiceStatus = voiceReadiness(state, deviceId);
  const first = useFirstSection(settings.data ?? null, settings.error !== null, state, demo);
  const shown = deleting ? 'data' : isSection(hash) ? hash : first;

  useEffect(() => {
    if (!wide && !deleting && isSection(hash)) document.getElementById(`setup-${hash}`)?.scrollIntoView?.({ block: 'start' });
  }, [wide, hash, deleting]);

  const dots: Partial<Record<SetupSection, Status>> = { console: consoleStatus, voice: voiceStatus };
  const panels: Record<SetupSection, ReactNode> = {
    console: demo ? <DemoConsoleSection key="console" /> : <ConsoleSection key="console" onSaved={settings.reload} />,
    voice: <VoiceSection key="voice" />,
    profiles: <ProfilesSection key="profiles" />,
    preferences: <PreferencesSection key="preferences" />,
    catalogue: demo ? null : <CatalogueSection key="catalogue" />,
    data: deleting ? <DeleteHistoryView key="delete-history" /> : <StorageSection key="data" />
  };
  const listed = SECTIONS.filter(section => panels[section.id] !== null);

  return (
    <section className="setup" aria-labelledby="setup-title">
      <h1 id="setup-title">Setup</h1>
      <p className="lede">Two things are needed before you train: the console and a device for the voice.</p>
      {wide ? (
        <>
          <ul className="setup-chips" aria-label="Readiness">
            <ReadinessChip status={consoleStatus} />
            <ReadinessChip status={voiceStatus} />
          </ul>
          <div className="setup-layout">
            <nav className="setup-nav" aria-label="Setup sections">
              {listed.map(section => (
                <Link key={section.id} to={paths.setup(section.id)} current={section.id === shown} className="setup-nav-link">
                  <span className={`dot ${dots[section.id]?.tone ?? 'none'}`} aria-hidden="true" />
                  {section.label}
                </Link>
              ))}
            </nav>
            <div className="setup-panel">{shown ? panels[shown] : null}</div>
          </div>
        </>
      ) : deleting ? (
        <>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link to={paths.setup()}>Setup</Link> / <Link to={paths.setup('data')}>Data</Link> / Delete history
          </nav>
          <DeleteHistoryView />
        </>
      ) : (
        <div className="setup-stack">{listed.map(section => panels[section.id])}</div>
      )}
    </section>
  );
}
