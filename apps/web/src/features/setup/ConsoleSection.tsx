import { useEffect, useState, type FormEvent } from 'react';
import { connectionSettingsSchema, type ReceptionCheck } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { useLive } from '../../api/live.tsx';
import { errorText, useResource } from '../../app/resource.ts';
import { StatusDot } from '../../app/Shell.tsx';
import { telemetryStatus } from '../../app/status.ts';

export function addressProblem(value: string): string | null {
  if (!value.trim()) return 'Enter the console address.';
  if (connectionSettingsSchema.safeParse({ ps5Ip: value.trim() }).success) return null;
  return 'This is not an IPv4 address. Enter four numbers from 0 to 255 with dots between them, as the PS5 shows it.';
}

function receptionText(check: ReceptionCheck, carName: string | null): string {
  if (check.packets === 0) {
    return `No packets in ${(check.durationMs / 1000).toFixed(1)} s. Check that the PS5 is on, that GT7 is open past the title screen, and that the address is right.`;
  }
  const car = carName ? ` Car: ${carName}.` : check.carId !== null ? ` Car ID ${check.carId}.` : '';
  const undecoded = check.packets - check.decoded;
  const decodeNote = undecoded > 0 ? ` ${undecoded} packets could not be decoded.` : '';
  return `Receiving: ${check.packets} packets in ${(check.durationMs / 1000).toFixed(1)} s.${car}${decodeNote}`;
}

export function ConsoleSection() {
  const settings = useResource(() => api.settings(), []);
  const { state, connected } = useLive();
  const [address, setAddress] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [reception, setReception] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (settings.data?.ps5Ip) setAddress(settings.data.ps5Ip);
  }, [settings.data]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(null);
    const found = addressProblem(address);
    setProblem(found);
    if (found) return;
    try {
      const result = await api.setConsoleAddress(address.trim());
      setSaved(`Saved. GT7 Tutor listens for ${result.ps5Ip}.`);
      settings.reload();
    } catch (error) {
      setProblem(errorText(error));
    }
  };

  const check = async () => {
    setChecking(true);
    setReception(null);
    try {
      const result = await api.checkReception();
      const carName = result.carId === null ? null : await api.carName(result.carId).then(car => car.name, () => null);
      setReception(receptionText(result, carName));
    } catch (error) {
      setReception(errorText(error));
    } finally {
      setChecking(false);
    }
  };

  const telemetry = telemetryStatus(state, connected);
  return (
    <section className="panel" aria-labelledby="console-title">
      <h2 id="console-title">Console</h2>
      <p className="sub">On the PS5: Settings, Network, View Connection Status, IPv4 Address. The address can change after a router restart.</p>
      <form onSubmit={save} noValidate>
        <div className="field-row">
          <div className="field">
            <label htmlFor="console-address">PS5 address</label>
            <input
              id="console-address"
              inputMode="decimal"
              autoComplete="off"
              value={address}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? 'console-address-problem' : undefined}
              onChange={event => setAddress(event.target.value)}
            />
          </div>
          <button className="btn inline" type="submit">
            Save address
          </button>
        </div>
        {problem ? (
          <p className="error" id="console-address-problem" role="alert">
            {problem}
          </p>
        ) : null}
        {saved ? <p className="sub" role="status">{saved}</p> : null}
      </form>
      <div className="btn-row" style={{ marginTop: 14 }}>
        <button className="btn inline ghost" type="button" onClick={check} disabled={checking}>
          {checking ? 'Listening…' : 'Check reception'}
        </button>
        <span className="sub">
          <StatusDot status={telemetry} />
          {telemetry.text}
        </span>
      </div>
      {reception ? (
        <p className="notice" role="status">
          {reception}
        </p>
      ) : null}
      <p className="sub" style={{ marginTop: 10 }}>
        The computer must accept UDP on port 33740. Allow it in the firewall if the check finds no packets.
      </p>
    </section>
  );
}

export function DemoConsoleSection() {
  return (
    <section className="panel" aria-labelledby="console-title">
      <h2 id="console-title">Console</h2>
      <p className="notice">Demo mode uses recorded data.</p>
      <p className="sub" style={{ marginTop: 10 }}>
        No PS5 is needed. To connect your own console, stop the demo and start GT7 Tutor with <code>pnpm start</code>.
      </p>
    </section>
  );
}
