import { useDemo } from '../../app/demo.tsx';
import { CatalogueSection } from './CatalogueSection.tsx';
import { ConsoleSection, DemoConsoleSection } from './ConsoleSection.tsx';
import { ProfilesSection } from './ProfilesSection.tsx';
import { StorageSection } from './StorageSection.tsx';
import { GameVersionSection, ThemeSection } from './PreferenceSections.tsx';
import { VoiceSection } from './VoiceSection.tsx';
import './setup.css';

export function SetupView() {
  const demo = useDemo();
  return (
    <section aria-labelledby="setup-title">
      <h1 id="setup-title">Setup</h1>
      <p className="lede">Connect the console and choose the device that plays the voice. You do this once; the other settings can wait.</p>
      <div className="grid-sections">
        {demo ? <DemoConsoleSection /> : <ConsoleSection />}
        <VoiceSection />
        <GameVersionSection />
        <ThemeSection />
        <StorageSection />
        <ProfilesSection />
        {demo ? null : <CatalogueSection />}
      </div>
    </section>
  );
}
