import { useEffect, useState, type FormEvent } from 'react';
import { connectionSettingsSchema, type ReceptionCheck } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { useLiveState } from '../../api/live.tsx';
import { IconButton } from '../../app/IconButton.tsx';
import { formatClock } from '../../app/format.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { telemetryStatus, type Status } from '../../app/status.ts';
import { t } from '../../app/i18n.ts';

export function addressProblem(value: string): string | null {
  if (!value.trim()) return t('setup.console.address-empty');
  if (connectionSettingsSchema.safeParse({ ps5Ip: value.trim() }).success) return null;
  return t('setup.console.address-invalid');
}

function packetsText(check: ReceptionCheck): string {
  const seconds = (check.durationMs / 1000).toFixed(1);
  if (check.packets === 0) {
    return t('setup.console.no-packets', { seconds });
  }
  const undecoded = check.packets - check.decoded;
  const receiving = t('setup.console.receiving', { count: check.packets, seconds });
  return undecoded > 0 ? t('setup.console.receiving-undecoded', { receiving, undecoded: t('setup.console.undecoded', { count: undecoded }) }) : receiving;
}

function carText(check: ReceptionCheck, carName: string | null): string | null {
  if (carName) return t('setup.console.car', { name: carName });
  return check.carId !== null ? t('setup.console.car-id', { id: check.carId }) : null;
}

type Reception = { status: Status; car: string | null; at: Date };

function receptionNotice(reception: Reception): string {
  const text = reception.status.text.endsWith('.') ? reception.status.text : `${reception.status.text}.`;
  return reception.car ? `${text} ${reception.car}.` : text;
}

type ConsoleFormProps = { layout: 'rows' | 'inline'; onChecked?(receiving: boolean): void; onSaved?(ps5Ip: string): void };

export function ConsoleForm({ layout, onChecked, onSaved }: ConsoleFormProps) {
  const settings = useResource(() => api.settings(), []);
  const { state, connected } = useLiveState(snapshot => snapshot);
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
      setSaved(t('setup.console.saved', { address: result.ps5Ip ?? '' }));
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
              <label htmlFor="console-address">{t('setup.console.address')}</label>
              {input}
            </div>
            <IconButton icon="check" label={t('setup.console.save-and-check')} primary type="submit" disabled={checking} />
          </div>
          {problemText}
        </form>
        {reception ? (
          <p className="notice" role="status">
            {receptionNotice(reception)}
          </p>
        ) : null}
        <p className="sub" style={{ marginTop: 10 }}>
          {t('setup.console.firewall')}
        </p>
      </>
    );
  }

  const status = reception?.status ?? telemetryStatus(state, connected);
  const caption = reception ? [reception.car, t('setup.console.checked', { time: formatClock(reception.at) })].filter(Boolean).join(' · ') : null;
  return (
    <>
      <form className="pref" onSubmit={save} noValidate>
        <span className="pref-text">
          <label htmlFor="console-address">{t('setup.console.address')}</label>
          <span className="sub" id="console-address-hint">
            {t('setup.console.address-hint')}
          </span>
        </span>
        <div className="pref-control">
          <div className="field-pair">
            {input}
            <IconButton icon="check" label={t('setup.console.save-and-check')} primary type="submit" disabled={checking} />
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
          <span>{t('setup.console.telemetry')}</span>
          <span className="sub">{t('setup.console.firewall')}</span>
        </span>
        <div className="pref-control">
          <div className="field-pair telemetry-pair">
            <span className="telemetry-status" role="status">
              <span className={`telemetry-line${status.tone === 'off' ? ' error' : ''}`}>
                {checking ? t('setup.console.listening') : status.text}
              </span>
              {caption && !checking ? <span className="sub">{caption}</span> : null}
            </span>
            <IconButton icon="refresh" label={t('setup.console.check-again')} onClick={() => void check()} disabled={checking} />
          </div>
        </div>
      </div>
    </>
  );
}
