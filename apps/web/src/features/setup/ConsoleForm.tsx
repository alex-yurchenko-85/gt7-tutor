import { useEffect, useState, type FormEvent } from 'react';
import { connectionSettingsSchema, type ReceptionCheck } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { useLive } from '../../api/live.tsx';
import { IconButton } from '../../app/IconButton.tsx';
import { errorText, useResource } from '../../app/resource.ts';
import { StatusDot } from '../../app/Shell.tsx';
import { telemetryStatus, type Status } from '../../app/status.ts';

const FIREWALL_NOTE = 'The computer must accept UDP on port 33740. Allow it in the firewall if the check finds no packets.';

export function addressProblem(value: string): string | null {
  if (!value.trim()) return 'Enter the console address.';
  if (connectionSettingsSchema.safeParse({ ps5Ip: value.trim() }).success) return null;
  return 'This is not an IPv4 address. Enter four numbers from 0 to 255 with dots between them, as the PS5 shows it.';
}

function packetsText(check: ReceptionCheck): string {
  const seconds = (check.durationMs / 1000).toFixed(1);
  if (check.packets === 0) {
    return `No packets in ${seconds} s. Check that the PS5 is on, that GT7 is open past the title screen, and that the address is right.`;
  }
  const undecoded = check.packets - check.decoded;
  const receiving = `Receiving: ${check.packets} packets in ${seconds} s`;
  return undecoded > 0 ? `${receiving}. ${undecoded} packets could not be decoded.` : receiving;
}

function carText(check: ReceptionCheck, carName: string | null): string | null {
  if (carName) return `Car: ${carName}`;
  return check.carId !== null ? `Car ID ${check.carId}` : null;
}

function clockText(at: Date): string {
  return at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

type Reception = { status: Status; car: string | null; at: Date };

function receptionNotice(reception: Reception): string {
  const text = reception.status.text.endsWith('.') ? reception.status.text : `${reception.status.text}.`;
  return reception.car ? `${text} ${reception.car}.` : text;
}

type ConsoleFormProps = { layout: 'rows' | 'inline'; onChecked?(receiving: boolean): void; onSaved?(ps5Ip: string): void };

export function ConsoleForm({ layout, onChecked, onSaved }: ConsoleFormProps) {
  const settings = useResource(() => api.settings(), []);
  const { state, connected } = useLive();
  const [address, setAddress] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [reception, setReception] = useState<Reception | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (settings.data?.ps5Ip) setAddress(settings.data.ps5Ip);
  }, [settings.data]);

  const check = async () => {
    setChecking(true);
    setReception(null);
    try {
      const result = await api.checkReception();
      const carName = result.carId === null ? null : await api.carName(result.carId).then(car => car.name, () => null);
      const receiving = result.packets > 0;
      setReception({ status: { tone: receiving ? 'on' : 'off', text: packetsText(result) }, car: carText(result, carName), at: new Date() });
      onChecked?.(receiving);
    } catch (error) {
      setReception({ status: { tone: 'off', text: errorText(error) }, car: null, at: new Date() });
      onChecked?.(false);
    } finally {
      setChecking(false);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(null);
    const found = addressProblem(address);
    setProblem(found);
    if (found) return;
    try {
      const result = await api.setConsoleAddress(address.trim());
      setSaved(`Saved. GT7 Tutor listens for ${result.ps5Ip}.`);
      onSaved?.(result.ps5Ip ?? address.trim());
      settings.reload();
    } catch (error) {
      setProblem(errorText(error));
      return;
    }
    await check();
  };

  const input = (
    <input
      id="console-address"
      className="input"
      inputMode="decimal"
      autoComplete="off"
      value={address}
      aria-invalid={problem ? true : undefined}
      aria-describedby={problem ? 'console-address-problem' : layout === 'rows' ? 'console-address-hint' : undefined}
      onChange={event => setAddress(event.target.value)}
    />
  );
  const problemText = problem ? (
    <p className="error" id="console-address-problem" role="alert">
      {problem}
    </p>
  ) : null;

  if (layout === 'inline') {
    return (
      <>
        <form onSubmit={save} noValidate>
          <div className="field-pair">
            <div className="field">
              <label htmlFor="console-address">PS5 address</label>
              {input}
            </div>
            <IconButton icon="check" label="Save and check reception" primary type="submit" disabled={checking} />
          </div>
          {problemText}
        </form>
        {reception ? (
          <p className="notice" role="status">
            {receptionNotice(reception)}
          </p>
        ) : null}
        <p className="sub" style={{ marginTop: 10 }}>
          {FIREWALL_NOTE}
        </p>
      </>
    );
  }

  const status = reception?.status ?? telemetryStatus(state, connected);
  const caption = reception ? [reception.car, `checked ${clockText(reception.at)}`].filter(Boolean).join(' · ') : null;
  return (
    <>
      <form className="pref" onSubmit={save} noValidate>
        <span className="pref-text">
          <label htmlFor="console-address">PS5 address</label>
          <span className="sub" id="console-address-hint">
            GT7 Tutor asks the console for telemetry at this address. Saving also checks the reception.
          </span>
        </span>
        <div className="pref-control">
          <div className="field-pair">
            {input}
            <IconButton icon="check" label="Save and check" primary type="submit" disabled={checking} />
          </div>
          {problemText}
          {saved ? (
            <p className="sub" role="status">
              {saved}
            </p>
          ) : null}
        </div>
      </form>
      <div className="pref">
        <span className="pref-text">
          <span>Telemetry</span>
          <span className="sub">{FIREWALL_NOTE}</span>
        </span>
        <div className="pref-control">
          <div className="field-pair telemetry-pair">
            <span className="telemetry-status" role="status">
              <span className="telemetry-line">
                <StatusDot status={status} />
                {checking ? 'Listening…' : status.text}
              </span>
              {caption && !checking ? <span className="sub">{caption}</span> : null}
            </span>
            <IconButton icon="refresh" label="Check again" onClick={() => void check()} disabled={checking} />
          </div>
        </div>
      </div>
    </>
  );
}
