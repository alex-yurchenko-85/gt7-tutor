import type { ProfileCredentials } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { DemoLabel, useDemo } from '../../app/demo.tsx';
import { createProfileError, InputProblem, ProfileForm, signInError, validateCredentials } from './ProfileForm.tsx';

async function checked(credentials: ProfileCredentials, send: (credentials: ProfileCredentials) => Promise<unknown>): Promise<void> {
  const problem = validateCredentials(credentials);
  if (problem) throw new InputProblem(problem);
  await send(credentials);
}

export function FirstProfileView({ onSignedIn }: { onSignedIn(): void }) {
  return (
    <div className="auth">
      <div className="panel">
        <h1>Create the first profile</h1>
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
      </div>
    </div>
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

export function SignInView({ onSignedIn }: { onSignedIn(): void }) {
  const demo = useDemo();
  return (
    <div className="auth">
      <DemoLabel />
      <div className="panel">
        <h1>Sign in</h1>
        {demo ? (
          <>
            <p className="lede">This demo has one profile. The fields are filled in for you.</p>
            <DemoCredentials profileName={demo.profileName} password={demo.password} />
          </>
        ) : (
          <p className="lede">Sign in with the name and password of your profile.</p>
        )}
        <ProfileForm
          key={demo ? 'demo' : 'profile'}
          submitLabel="Sign in"
          {...(demo ? { initial: { name: demo.profileName, password: demo.password } } : {})}
          describeError={signInError}
          onSubmit={async credentials => {
            await checked(credentials, api.signIn);
            onSignedIn();
          }}
        />
      </div>
    </div>
  );
}
