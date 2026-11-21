import { useId, useState, type FormEvent } from 'react';
import type { ProfileCredentials } from '@gt7/contracts';
import { ApiError } from '../../api/client.ts';
import { t } from '../../app/i18n.ts';

type ProfileFormProps = {
  submitLabel: string;
  passwordHint?: string;
  initial?: ProfileCredentials;
  onSubmit(credentials: ProfileCredentials): Promise<void>;
  describeError(error: unknown): string;
  onCancel?(): void;
};

export function ProfileForm({ submitLabel, passwordHint, initial, onSubmit, describeError, onCancel }: ProfileFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [password, setPassword] = useState(initial?.password ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name: name.trim(), password });
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={`${id}-name`}>{t('auth.form.name')}</label>
        <input id={`${id}-name`} autoComplete="username" value={name} maxLength={40} onChange={event => setName(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-password`}>{t('auth.form.password')}</label>
        <input
          id={`${id}-password`}
          type="password"
          autoComplete={passwordHint ? 'new-password' : 'current-password'}
          value={password}
          onChange={event => setPassword(event.target.value)}
        />
        {passwordHint ? <span className="sub">{passwordHint}</span> : null}
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {onCancel ? (
        <div className="form-actions">
          <button className="btn" type="submit" disabled={busy}>
            {submitLabel}
          </button>
          <button className="btn ghost" type="button" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <button className="btn" type="submit" disabled={busy}>
          {submitLabel}
        </button>
      )}
    </form>
  );
}

export class InputProblem extends Error {}

export function validateCredentials(credentials: ProfileCredentials): string | null {
  if (!credentials.name) return t('auth.form.no-name');
  if (credentials.password.length < 8) return t('auth.form.short-password');
  return null;
}

export function signInError(error: unknown): string {
  if (error instanceof InputProblem) return error.message;
  if (error instanceof ApiError) {
    if (error.status === 401) return t('auth.form.wrong-password');
    if (error.status === 429) return t('auth.form.too-many');
    if (error.status === 400) return t('auth.form.invalid');
    return error.message;
  }
  return t('auth.form.no-server');
}

export function createProfileError(error: unknown): string {
  if (error instanceof InputProblem) return error.message;
  if (error instanceof ApiError) {
    if (error.status === 409) return error.message;
    if (error.status === 400) return t('auth.form.invalid');
    return error.message;
  }
  return t('auth.form.no-server');
}
