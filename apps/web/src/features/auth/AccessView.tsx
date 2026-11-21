import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { ProfileCredentials } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { DemoLabel, useDemo } from '../../app/demo.tsx';
import { useWideLayout } from '../../app/layout.ts';
import { Logo } from '../../app/Logo.tsx';
import { useResource } from '../../app/resource.ts';
import { createProfileError, InputProblem, ProfileForm, signInError, validateCredentials } from './ProfileForm.tsx';
import { ProfileStrip } from './ProfileStrip.tsx';
import { t } from '../../app/i18n.ts';

async function checked(credentials: ProfileCredentials, send: (credentials: ProfileCredentials) => Promise<unknown>): Promise<void> {
  const problem = validateCredentials(credentials);
  if (problem) throw new InputProblem(problem);
  await send(credentials);
}

function AccessScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="access">
      <section className="access-brand" aria-label={t('auth.brand.label')}>
        <Logo height={96} />
        <p className="access-tagline">{t('auth.brand.tagline')}</p>
        <p className="access-note">{t('auth.brand.note')}</p>
      </section>
      <section className="access-main" aria-labelledby="access-title">
        <div className="access-card">
          <DemoLabel />
          <h1 id="access-title">{title}</h1>
          {children}
        </div>
      </section>
    </div>
  );
}

export function FirstProfileView({ onSignedIn }: { onSignedIn(): void }) {
  return (
    <AccessScreen title={t('auth.first.title')}>
      <p className="lede">{t('auth.first.text')}</p>
      <ProfileForm
        submitLabel={t('auth.first.submit')}
        passwordHint={t('auth.first.password-hint')}
        describeError={createProfileError}
        onSubmit={async credentials => {
          await checked(credentials, api.createFirstProfile);
          onSignedIn();
        }}
      />
    </AccessScreen>
  );
}

function DemoCredentials({ profileName, password }: { profileName: string; password: string }) {
  return (
    <dl className="demo-credentials">
      <div>
        <dt>{t('auth.demo.profile')}</dt>
        <dd>{profileName}</dd>
      </div>
      <div>
        <dt>{t('auth.demo.password')}</dt>
        <dd>{password}</dd>
      </div>
    </dl>
  );
}

function PasswordForm({ name, initialPassword, onSignedIn }: { name: string; initialPassword: string; onSignedIn(): void }) {
  const [password, setPassword] = useState(initialPassword);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await checked({ name, password }, api.signIn);
      onSignedIn();
    } catch (reason) {
      setError(signInError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="access-form" onSubmit={submit} noValidate>
      <input type="text" name="username" autoComplete="username" value={name} readOnly hidden />
      <div className="field">
        <label htmlFor={`${id}-password`}>{t('auth.sign-in.password-for', { name })}</label>
        <input id={`${id}-password`} type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} />
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="btn" type="submit" disabled={busy}>
        {t('auth.sign-in.submit')}
      </button>
    </form>
  );
}

function ProfileChoice({ onSignedIn }: { onSignedIn(): void }) {
  const demo = useDemo();
  const profiles = useResource(() => api.authProfiles(), []);
  const [picked, setPicked] = useState<string | null>(null);
  const list = profiles.data ?? [];
  const only = list.length === 1 ? list[0]!.name : null;
  const preferred = demo && list.some(profile => profile.name === demo.profileName) ? demo.profileName : only;
  const selected = picked ?? preferred;

  if (profiles.error) {
    return (
      <p className="error" role="alert">
        {signInError(profiles.error)}
      </p>
    );
  }
  if (!profiles.data) return <p className="sub">{t('auth.sign-in.reading')}</p>;
  return (
    <>
      <ProfileStrip profiles={list} selected={selected} onSelect={setPicked} />
      {selected ? (
        <PasswordForm
          key={selected}
          name={selected}
          initialPassword={demo && selected === demo.profileName ? demo.password : ''}
          onSignedIn={onSignedIn}
        />
      ) : (
        <p className="access-choose">{t('auth.sign-in.choose')}</p>
      )}
    </>
  );
}

export function SignInView({ onSignedIn }: { onSignedIn(): void }) {
  const demo = useDemo();
  const wide = useWideLayout();
  return (
    <AccessScreen title={t('auth.sign-in.title')}>
      {demo ? (
        <>
          <p className="lede">{t('auth.sign-in.demo')}</p>
          <DemoCredentials profileName={demo.profileName} password={demo.password} />
        </>
      ) : (
        <p className="lede">{wide ? t('auth.sign-in.choose-wide') : t('auth.sign-in.choose-phone')}</p>
      )}
      <ProfileChoice onSignedIn={onSignedIn} />
      <p className="access-help">
        {t('auth.sign-in.help')}
        {wide ? ` ${t('auth.sign-in.help-wide')}` : null}
      </p>
    </AccessScreen>
  );
}
