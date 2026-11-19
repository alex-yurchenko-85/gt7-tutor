import { useEffect, useState, type FormEvent } from 'react';
import { STATE_RATES, type StateRate } from '@gt7/contracts';
import { useLiveConnection } from '../../api/live.tsx';
import { IconButton } from '../../app/IconButton.tsx';
import { api } from '../../api/client.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { setStateRate, stateRate } from '../../app/state-rate.ts';
import { RadioGroup, type RadioOption } from '../../app/RadioGroup.tsx';
import { ThemeSwitch } from '../../app/ThemeSwitch.tsx';

function GameVersionRow() {
  const settings = useResource(() => api.settings(), []);
  const [version, setVersion] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data?.gameVersion) setVersion(settings.data.gameVersion);
  }, [settings.data]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setProblem(null);
    if (!version.trim()) {
      setProblem('Enter the game version, for example 1.65.');
      return;
    }
    try {
      const result = await api.setGameVersion(version.trim());
      setMessage(`Saved: ${result.gameVersion}. References recorded with another version are marked for a check.`);
    } catch (error) {
      setProblem(errorText(error));
    }
  };

  return (
    <form className="pref" onSubmit={save} noValidate>
      <span className="pref-text">
        <label htmlFor="game-version">GT7 version</label>
        <span className="sub" id="game-version-hint">
          Stored with each new reference.
        </span>
      </span>
      <div className="pref-control">
        <div className="field-pair">
          <input
            id="game-version"
            className="input"
            value={version}
            maxLength={40}
            aria-describedby="game-version-hint"
            onChange={event => setVersion(event.target.value)}
          />
          <IconButton icon="check" label="Save the game version" primary type="submit" />
        </div>
        {problem ? (
          <p className="error" role="alert">
            {problem}
          </p>
        ) : null}
        {message ? (
          <p className="sub" role="status">
            {message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

const RATE_OPTIONS: RadioOption<StateRate>[] = STATE_RATES.map(rate => ({ value: rate, ariaLabel: `${rate} per second`, content: `${rate}/s` }));

function StateRateRow() {
  const { send } = useLiveConnection();
  const [rate, setRate] = useState<StateRate>(stateRate);
  const select = (next: StateRate) => {
    setRate(next);
    setStateRate(next);
    send({ type: 'state-rate', perSecond: next });
  };
  return (
    <div className="pref">
      <span className="pref-text">
        <span id="state-rate-title">Screen updates while driving</span>
        <span className="device-tag">On this device</span>
        <span className="sub">
          How often this device gets the speed, the distance, the gap and the map point while you drive. Higher values move them more smoothly, but
          use more battery and network and can make the page slower on an older phone. With the voice on this device, a busy page can also delay a
          cue a little. The voice cues themselves are sent at once, whatever you choose.
        </span>
      </span>
      <div className="pref-control">
        <RadioGroup className="theme-switch" labelledBy="state-rate-title" options={RATE_OPTIONS} value={rate} onChange={select} />
      </div>
    </div>
  );
}

export function PreferencesSection() {
  return (
    <section className="panel setup-section" id="setup-preferences" aria-labelledby="preferences-title">
      <h2 id="preferences-title">Preferences</h2>
      <div className="pref">
        <span className="pref-text">
          <span>Theme</span>
          <span className="sub">The Drive view is always dark.</span>
        </span>
        <div className="pref-control">
          <ThemeSwitch compact={false} />
        </div>
      </div>
      <StateRateRow />
      <GameVersionRow />
    </section>
  );
}
