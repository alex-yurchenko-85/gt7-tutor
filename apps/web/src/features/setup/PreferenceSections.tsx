import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { STATE_RATES, type StateRate } from '@gt7/contracts';
import { useLive } from '../../api/live.tsx';
import { IconButton } from '../../app/IconButton.tsx';
import { api } from '../../api/client.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { setStateRate, stateRate } from '../../app/state-rate.ts';
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

function StateRateRow() {
  const { send } = useLive();
  const [rate, setRate] = useState<StateRate>(stateRate);
  const select = (next: StateRate) => {
    setRate(next);
    setStateRate(next);
    send({ type: 'state-rate', perSecond: next });
  };
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = STATE_RATES[(STATE_RATES.indexOf(rate) + step + STATE_RATES.length) % STATE_RATES.length]!;
    select(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-rate="${next}"]`)?.focus();
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
        <div className="theme-switch" role="radiogroup" aria-labelledby="state-rate-title" onKeyDown={move}>
          {STATE_RATES.map(option => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={rate === option}
              aria-label={`${option} per second`}
              tabIndex={rate === option ? 0 : -1}
              data-rate={option}
              onClick={() => select(option)}
            >
              {option}/s
            </button>
          ))}
        </div>
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
