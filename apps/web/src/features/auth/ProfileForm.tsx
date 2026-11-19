import { useId, useState, type FormEvent } from 'react';
import type { ProfileCredentials } from '@gt7/contracts';
import { ApiError } from '../../api/client.ts';

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
        <label htmlFor={`${id}-name`}>Name</label>
        <input id={`${id}-name`} autoComplete="username" value={name} maxLength={40} onChange={event => setName(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-password`}>Password</label>
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
            Cancel
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
  if (!credentials.name) return 'Enter a name.';
  if (credentials.password.length < 8) return 'The password needs at least 8 characters.';
  return null;
}

export function signInError(error: unknown): string {
  if (error instanceof InputProblem) return error.message;
  if (error instanceof ApiError) {
    if (error.status === 401) return 'The password is wrong. Check it and try again.';
    if (error.status === 429) return 'Too many failed sign-ins for this name. Wait 15 minutes, then try again.';
    if (error.status === 400) return 'Enter a name and a password of at least 8 characters.';
    return error.message;
  }
  return 'The server did not answer. Check that GT7 Tutor is running on the computer.';
}

export function createProfileError(error: unknown): string {
  if (error instanceof InputProblem) return error.message;
  if (error instanceof ApiError) {
    if (error.status === 409) return error.message;
    if (error.status === 400) return 'Enter a name and a password of at least 8 characters.';
    return error.message;
  }
  return 'The server did not answer. Check that GT7 Tutor is running on the computer.';
}
