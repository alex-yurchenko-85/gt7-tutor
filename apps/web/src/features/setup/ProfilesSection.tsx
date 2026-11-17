import { useState } from 'react';
import { api } from '../../api/client.ts';
import { useSession } from '../../app/session.tsx';
import { createProfileError, InputProblem, ProfileForm, validateCredentials } from '../auth/ProfileForm.tsx';

export function ProfilesSection() {
  const { user, signOut } = useSession();
  const [created, setCreated] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  return (
    <section className="panel" aria-labelledby="profiles-title">
      <h2 id="profiles-title">Profiles</h2>
      <div className="kv">
        <span>Signed in as</span>
        <b>{user.name}</b>
      </div>
      <button className="btn inline ghost" type="button" style={{ marginTop: 10 }} onClick={() => void signOut()}>
        Sign out
      </button>
      <h3>Add a profile</h3>
      <p className="sub">Each profile has its own exercises and attempts. Only one profile can train at a time, because there is one console.</p>
      <ProfileForm
        key={formKey}
        submitLabel="Add profile"
        passwordHint="At least 8 characters."
        describeError={createProfileError}
        onSubmit={async credentials => {
          const problem = validateCredentials(credentials);
          if (problem) throw new InputProblem(problem);
          const response = await api.createProfile(credentials);
          setCreated(`Profile ${response.user.name} is ready. Sign out to use it.`);
          setFormKey(value => value + 1);
        }}
      />
      {created ? (
        <p className="sub" role="status">
          {created}
        </p>
      ) : null}
    </section>
  );
}
