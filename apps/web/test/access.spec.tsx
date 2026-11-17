import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiStub, renderApp, setViewportWidth } from './support.tsx';

describe('access', () => {
  it('first_visit_shows_create_profile', async () => {
    setViewportWidth(1280);
    new ApiStub().on('GET /api/auth/state', { hasUsers: false, user: null }).install();
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Create the first profile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create profile' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('sign_in_error_is_specific', async () => {
    setViewportWidth(1280);
    const api = new ApiStub()
      .on('GET /api/auth/state', { hasUsers: true, user: null })
      .on('POST /api/auth/sign-in', (body: unknown) =>
        (body as { password: string }).password === 'locked out'
          ? { status: 429, body: { statusCode: 429, message: 'Too many failed sign-in attempts. Wait 15 minutes and try again.' } }
          : { status: 401, body: { statusCode: 401, message: 'Wrong name or password.' } }
      )
      .install();
    renderApp();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Name'), 'Driver');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The password needs at least 8 characters.');
    expect(api.called('POST /api/auth/sign-in')).toBe(false);

    await user.type(screen.getByLabelText('Password'), 'wrong password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The name or the password is wrong.'));

    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'locked out');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Wait 15 minutes'));
  });
});
