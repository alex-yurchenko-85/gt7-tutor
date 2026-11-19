import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { ProfileCredentials } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { DemoLabel, useDemo } from '../../app/demo.tsx';
import { useWideLayout } from '../../app/layout.ts';
import { Logo } from '../../app/Logo.tsx';
import { useResource } from '../../app/resource.ts';
import { createProfileError, InputProblem, ProfileForm, signInError, validateCredentials } from './ProfileForm.tsx';
import { ProfileStrip } from './ProfileStrip.tsx';

async function checked(credentials: ProfileCredentials, send: (credentials: ProfileCredentials) => Promise<unknown>): Promise<void> {
  const problem = validateCredentials(credentials);
  if (problem) throw new InputProblem(problem);
  await send(credentials);
}

function AccessScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="access">
      <section className="access-brand" aria-label="GT7 Tutor">
        <Logo height={96} />
        <p className="access-tagline">Short voice cues while you drive the exercises of Gran Turismo 7.</p>
        <p className="access-note">Runs on your home network. Your data stays on this computer.</p>
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
    <AccessScreen title="Create the first profile">
      <p className="lede">
        GT7 Tutor keeps your exercises, references and attempts in a profile on this computer. The password keeps other people on your home
        network out of it.
      </p>
      <ProfileForm
        submitLabel="Create profile"
        passwordHint="At least 8 characters."
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
        <dt>Profile</dt>
        <dd>{profileName}</dd>
      </div>
      <div>
        <dt>Password</dt>
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
        <label htmlFor={`${id}-password`}>Password for {name}</label>
        <input id={`${id}-password`} type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} />
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="btn" type="submit" disabled={busy}>
        Sign in
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
  if (!profiles.data) return <p className="sub">Reading the profiles…</p>;
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
        <p className="access-choose">Select a profile to sign in.</p>
      )}
    </>
  );
}

export function SignInView({ onSignedIn }: { onSignedIn(): void }) {
  const demo = useDemo();
  const wide = useWideLayout();
  return (
    <AccessScreen title="Who is driving?">
      {demo ? (
        <>
          <p className="lede">This demo has one profile. Its password is filled in for you.</p>
          <DemoCredentials profileName={demo.profileName} password={demo.password} />
        </>
      ) : (
        <p className="lede">{wide ? 'Choose your profile, then enter its password.' : 'Swipe to your profile, then enter its password.'}</p>
      )}
      <ProfileChoice onSignedIn={onSignedIn} />
      <p className="access-help">
        Need another profile? Sign in, then add it in Setup › Profiles.
        {wide ? ' Everyone on your home network can see these names; the passwords keep the profiles apart.' : null}
      </p>
    </AccessScreen>
  );
}
