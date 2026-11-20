import { useState } from 'react';
import { api } from '../../api/client.ts';
import { useDemo } from '../../app/demo.tsx';
import { useSession } from '../../app/session.tsx';
import { createProfileError, InputProblem, ProfileForm, validateCredentials } from '../auth/ProfileForm.tsx';
import { ChangePasswordForm } from './ChangePasswordForm.tsx';
import { DeleteProfileDialog } from './DeleteProfileDialog.tsx';

export function ProfilesSection() {
  const { user, signOut } = useSession();
  const demo = useDemo() !== null;
  const [changing, setChanging] = useState(false);
  const [changed, setChanged] = useState(false);
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const toggleChange = () => {
    setChanged(false);
    setChanging(open => !open);
  };

  return (
    <section className="panel setup-section narrow-controls" id="setup-profiles" aria-labelledby="profiles-title">
      <h2 id="profiles-title">Profiles</h2>
      <p className="sub">Each profile has its own exercises and attempts. One profile trains at a time, because there is one console.</p>
      <div className="pref" role="group" aria-label={user.name}>
        <span className="profile-row">
          <span className="profile-avatar" aria-hidden="true">
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="pref-text">
            <b>{user.name}</b>
            <span className="sub">Signed in on this device</span>
          </span>
        </span>
        <div className="pref-control">
          {demo ? null : (
            <button className="btn ghost" type="button" aria-expanded={changing} aria-controls="change-password" onClick={toggleChange}>
              Change password
            </button>
          )}
          <button className="btn ghost" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
          {demo ? null : (
            <button className="btn danger" type="button" onClick={() => setDeleting(true)}>
              Delete profile
            </button>
          )}
          {changed ? (
            <p className="notice" role="status">
              Password changed.
            </p>
          ) : null}
        </div>
      </div>
      {deleting ? <DeleteProfileDialog onKeep={() => setDeleting(false)} /> : null}
      {changing ? (
        <ChangePasswordForm
          onCancel={() => setChanging(false)}
          onChanged={() => {
            setChanging(false);
            setChanged(true);
          }}
        />
      ) : null}
      <div className="pref">
        <span className="pref-text">
          <span>Add a profile</span>
          <span className="sub">A new profile signs in with its own name and password.</span>
        </span>
        <div className="pref-control">
          {adding ? (
            <ProfileForm
              submitLabel="Add profile"
              passwordHint="At least 8 characters."
              describeError={createProfileError}
              onCancel={() => setAdding(false)}
              onSubmit={async credentials => {
                const problem = validateCredentials(credentials);
                if (problem) throw new InputProblem(problem);
                const response = await api.createProfile(credentials);
                setCreated(`Profile ${response.user.name} is ready. Sign out to use it.`);
                setAdding(false);
              }}
            />
          ) : (
            <button
              className="btn ghost"
              type="button"
              aria-expanded={false}
              onClick={() => {
                setCreated(null);
                setAdding(true);
              }}
            >
              + Add a profile
            </button>
          )}
          {created ? (
            <p className="notice" role="status">
              {created}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
