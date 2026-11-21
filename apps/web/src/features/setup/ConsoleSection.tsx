import { ConsoleForm } from './ConsoleForm.tsx';
import { t } from '../../app/i18n.ts';
import { Rich } from '../../app/rich-text.tsx';

export function ConsoleSection({ onSaved }: { onSaved?(): void }) {
  return (
    <section className="panel setup-section" id="setup-console" aria-labelledby="console-title">
      <h2 id="console-title">{t('setup.console.title')}</h2>
      <p className="sub">{t('setup.console.where')}</p>
      <ConsoleForm layout="rows" {...(onSaved ? { onSaved } : {})} />
    </section>
  );
}

export function DemoConsoleSection() {
  return (
    <section className="panel setup-section" id="setup-console" aria-labelledby="console-title">
      <h2 id="console-title">{t('setup.console.title')}</h2>
      <p className="notice">{t('setup.console.demo')}</p>
      <p className="sub" style={{ marginTop: 10 }}>
        <Rich k="setup.console.demo-start" parts={{ command: <code>./start.sh</code> }} />
      </p>
    </section>
  );
}
