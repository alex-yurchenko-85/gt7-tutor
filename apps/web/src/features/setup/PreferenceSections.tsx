import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api/client.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { chooseTheme, storedTheme, type ThemeChoice } from '../../app/theme.ts';

export function GameVersionSection() {
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
    <section className="panel" aria-labelledby="game-version-title">
      <h2 id="game-version-title">Game version</h2>
      <p className="sub">A game update can change a demonstration. Each reference keeps the version you enter here.</p>
      <form onSubmit={save} noValidate>
        <div className="field-row">
          <div className="field">
            <label htmlFor="game-version">GT7 version</label>
            <input id="game-version" value={version} maxLength={40} onChange={event => setVersion(event.target.value)} />
          </div>
          <button className="btn inline" type="submit">
            Save version
          </button>
        </div>
      </form>
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
      {message ? <p className="sub" role="status">{message}</p> : null}
    </section>
  );
}

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
];

export function ThemeSection() {
  const [theme, setTheme] = useState<ThemeChoice>(storedTheme);
  const select = (choice: ThemeChoice) => {
    setTheme(choice);
    chooseTheme(choice);
  };
  return (
    <section className="panel" aria-labelledby="theme-title">
      <h2 id="theme-title">Theme</h2>
      <fieldset className="plain">
        <legend className="sub">The Drive view is always dark.</legend>
        <div className="segmented" style={{ marginTop: 8 }}>
          {THEMES.map(option => (
            <label key={option.value}>
              <input type="radio" name="theme" value={option.value} checked={theme === option.value} onChange={() => select(option.value)} />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}
