import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api/client.ts';
import { errorText } from '../../app/resource.ts';
import { t } from '../../app/i18n.ts';

const MIN_PASSWORD_LENGTH = 8;

function changeError(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) return t('setup.password.wrong');
  if (error instanceof ApiError && error.status === 429) return t('setup.password.too-many');
  return errorText(error);
}

export function ChangePasswordForm({ onChanged, onCancel }: { onChanged(): void; onCancel(): void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    if (!currentPassword) {
      setProblem(t('setup.password.no-current'));
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setProblem(t('setup.password.short'));
      return;
    }
    setBusy(true);
    try {
      await api.changePassword({ currentPassword, newPassword });
      onChanged();
    } catch (error) {
      setProblem(changeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="pref" id="change-password" onSubmit={submit} noValidate>
      <span className="pref-text">
        <span>{t('setup.password.title')}</span>
        <span className="sub">{t('setup.password.text')}</span>
      </span>
      <div className="pref-control">
        <div className="field">
          <label htmlFor="current-password">{t('setup.password.current')}</label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={event => setCurrentPassword(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="new-password">{t('setup.password.new')}</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={event => setNewPassword(event.target.value)}
          />
          <span className="sub">
            {t('setup.profiles.password-hint')}
          </span>
        </div>
        {problem ? (
          <p className="error" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="form-actions">
          <button className="btn" type="submit" disabled={busy}>
            {t('setup.password.save')}
          </button>
          <button className="btn ghost" type="button" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </form>
  );
}
