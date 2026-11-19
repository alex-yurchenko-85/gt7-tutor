import { ConsoleForm } from './ConsoleForm.tsx';

export function ConsoleSection({ onSaved }: { onSaved?(): void }) {
  return (
    <section className="panel setup-section" id="setup-console" aria-labelledby="console-title">
      <h2 id="console-title">Console</h2>
      <p className="sub">On the PS5: Settings, Network, View Connection Status, IPv4 Address. The address can change after a router restart.</p>
      <ConsoleForm layout="rows" {...(onSaved ? { onSaved } : {})} />
    </section>
  );
}

export function DemoConsoleSection() {
  return (
    <section className="panel setup-section" id="setup-console" aria-labelledby="console-title">
      <h2 id="console-title">Console</h2>
      <p className="notice">Demo mode uses recorded data.</p>
      <p className="sub" style={{ marginTop: 10 }}>
        No PS5 is needed. To connect your own console, stop the demo and start GT7 Tutor with <code>pnpm start</code>.
      </p>
    </section>
  );
}
