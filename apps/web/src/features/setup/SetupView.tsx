import { useEffect, useState, type ReactNode } from 'react';
import type { LiveState, MessageKey, Settings } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { useLiveState } from '../../api/live.tsx';
import { useDemo } from '../../app/demo.tsx';
import { useWideLayout } from '../../app/layout.ts';
import { useResource } from '../../app/resource.ts';
import { Link, paths, useRouter, type SetupSection } from '../../app/router.tsx';
import { CatalogueSection } from './CatalogueSection.tsx';
import { ConsoleSection, DemoConsoleSection } from './ConsoleSection.tsx';
import { DeleteHistoryView } from './DeleteHistoryView.tsx';
import { PreferencesSection } from './PreferenceSections.tsx';
import { ProfilesSection } from './ProfilesSection.tsx';
import { defaultSection } from './readiness.ts';
import { StorageSection } from './StorageSection.tsx';
import { VoiceSection } from './VoiceSection.tsx';
import './setup.css';
import { t } from '../../app/i18n.ts';

const SECTIONS: { id: SetupSection; label: MessageKey }[] = [
  { id: 'console', label: 'setup.nav.console' },
  { id: 'voice', label: 'setup.nav.voice' },
  { id: 'profiles', label: 'setup.nav.profiles' },
  { id: 'preferences', label: 'setup.nav.preferences' },
  { id: 'catalogue', label: 'setup.nav.catalogue' },
  { id: 'data', label: 'setup.nav.data' }
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

export function SetupView() {
  const demo = useDemo() !== null;
  const wide = useWideLayout();
  const { hash, route } = useRouter();
  const deleting = route.name === 'delete-history';
  const settings = useResource(() => api.settings(), []);
  const { state } = useLiveState(snapshot => snapshot);
  const first = useFirstSection(settings.data ?? null, settings.error !== null, state, demo);
  const shown = deleting ? 'data' : isSection(hash) ? hash : first;

  useEffect(() => {
    if (!wide && !deleting && isSection(hash)) document.getElementById(`setup-${hash}`)?.scrollIntoView?.({ block: 'start' });
  }, [wide, hash, deleting]);

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
      <h1 id="setup-title">{t('setup.title')}</h1>
      {wide ? (
        <>
          <div className="setup-layout">
            <nav className="setup-nav" aria-label={t('setup.nav.label')}>
              {listed.map(section => (
                <Link key={section.id} to={paths.setup(section.id)} current={section.id === shown} className="setup-nav-link">
                  {t(section.label)}
                </Link>
              ))}
            </nav>
            <div className="setup-panel">{shown ? panels[shown] : null}</div>
          </div>
        </>
      ) : deleting ? (
        <>
          <nav className="breadcrumb" aria-label={t('common.breadcrumb')}>
            <Link to={paths.setup()}>{t('setup.title')}</Link> / <Link to={paths.setup('data')}>{t('setup.nav.data')}</Link> / {t('setup.breadcrumb.delete-history')}
          </nav>
          <DeleteHistoryView />
        </>
      ) : (
        <div className="setup-stack">{listed.map(section => panels[section.id])}</div>
      )}
    </section>
  );
}
