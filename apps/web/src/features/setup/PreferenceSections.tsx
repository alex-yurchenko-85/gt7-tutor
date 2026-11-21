import { useEffect, useState, type FormEvent } from 'react';
import { STATE_RATES, type StateRate } from '@gt7/contracts';
import { useLiveConnection } from '../../api/live.tsx';
import { IconButton } from '../../app/IconButton.tsx';
import { api } from '../../api/client.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { setStateRate, stateRate } from '../../app/state-rate.ts';
import { RadioGroup, type RadioOption } from '../../app/RadioGroup.tsx';
import { ThemeSwitch } from '../../app/ThemeSwitch.tsx';
import { t } from '../../app/i18n.ts';

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
      setProblem(t('setup.preferences.version-empty'));
      return;
    }
    try {
      const result = await api.setGameVersion(version.trim());
      setMessage(t('setup.preferences.version-saved', { version: result.gameVersion ?? '' }));
    } catch (error) {
      setProblem(errorText(error));
    }
  };

  return (
    <form className="pref" onSubmit={save} noValidate>
      <span className="pref-text">
        <label htmlFor="game-version">{t('setup.preferences.version')}</label>
        <span className="sub" id="game-version-hint">
          {t('setup.preferences.version-hint')}
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
          <IconButton icon="check" label={t('setup.preferences.version-save')} primary type="submit" />
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

function rateOptions(): RadioOption<StateRate>[] {
  return STATE_RATES.map(rate => ({ value: rate, ariaLabel: t('setup.preferences.rate-label', { rate }), content: t('setup.preferences.rate', { rate }) }));
}

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
        <span id="state-rate-title">{t('setup.preferences.rate-title')}</span>
        <span className="sub">{t('setup.preferences.rate-text')}</span>
      </span>
      <div className="pref-control">
        <RadioGroup className="theme-switch" labelledBy="state-rate-title" options={rateOptions()} value={rate} onChange={select} />
      </div>
    </div>
  );
}

export function PreferencesSection() {
  return (
    <section className="panel setup-section" id="setup-preferences" aria-labelledby="preferences-title">
      <h2 id="preferences-title">{t('setup.preferences.title')}</h2>
      <div className="pref">
        <span className="pref-text">
          <span>{t('setup.preferences.theme')}</span>
          <span className="sub">{t('setup.preferences.theme-text')}</span>
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
