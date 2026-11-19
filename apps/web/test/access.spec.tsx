import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiStub, renderApp, setViewportWidth } from './support.tsx';

function signInApi(names: string[]): ApiStub {
  return new ApiStub().on('GET /api/auth/state', { hasUsers: true, user: null }).on(
    'GET /api/auth/profiles',
    names.map(name => ({ name }))
  );
}

describe('access', () => {
  it('first_visit_shows_create_profile', async () => {
    setViewportWidth(1280);
    new ApiStub().on('GET /api/auth/state', { hasUsers: false, user: null }).install();
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Create the first profile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create profile' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('sign_in_shows_logo', async () => {
    setViewportWidth(1280);
    signInApi(['alex']).install();
    renderApp();
    const brand = await screen.findByRole('region', { name: 'GT7 Tutor' });
    expect(within(brand).getAllByRole('img', { name: 'GT7 Tutor' })).toHaveLength(1);
    expect(within(brand).getByText('Short voice cues while you drive the exercises of Gran Turismo 7.')).toBeInTheDocument();
  });

  it('sign_in_lists_profiles_and_signs_in_the_selected_one', async () => {
    setViewportWidth(1280);
    const api = signInApi(['alex', 'maria']).on('POST /api/auth/sign-in', { status: 200, body: { user: { id: 'u2', name: 'maria' } } }).install();
    renderApp();
    const strip = await screen.findByRole('radiogroup', { name: 'Profiles' });
    expect(within(strip).getAllByRole('radio').map(radio => radio.textContent)).toEqual(['Aalex', 'Mmaria']);
    const user = userEvent.setup();
    await user.click(within(strip).getByRole('radio', { name: 'maria' }));
    expect(within(strip).getByRole('radio', { name: 'maria' })).toHaveAttribute('aria-checked', 'true');
    expect(within(strip).getByRole('radio', { name: 'alex' })).toHaveAttribute('aria-checked', 'false');
    await user.type(screen.getByLabelText('Password for maria'), 'maria password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(api.calls.find(call => call.path === '/api/auth/sign-in')?.body).toEqual({ name: 'maria', password: 'maria password' }));
  });

  it('password_form_names_the_profile_for_password_managers', async () => {
    setViewportWidth(1280);
    signInApi(['alex', 'maria']).install();
    renderApp();
    await userEvent.setup().click(await screen.findByRole('radio', { name: 'maria' }));
    const form = screen.getByLabelText('Password for maria').closest('form')!;
    const username = form.querySelector('input[autocomplete="username"]') as HTMLInputElement | null;
    expect(username).not.toBeNull();
    expect(username!.value).toBe('maria');
    expect(username!.readOnly).toBe(true);
    expect(username).not.toBeVisible();
  });

  it('one_profile_is_selected_at_once', async () => {
    setViewportWidth(390);
    signInApi(['alex']).install();
    renderApp();
    expect(await screen.findByRole('radio', { name: 'alex' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Password for alex')).toBeInTheDocument();
    expect(screen.getByText('Swipe to your profile, then enter its password.')).toBeInTheDocument();
  });

  it('password_field_waits_for_a_selection', async () => {
    setViewportWidth(1280);
    signInApi(['alex', 'maria']).install();
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'Who is driving?' })).toBeInTheDocument();
    expect(await screen.findByText('Select a profile to sign in.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Password/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    expect(screen.getByText('Choose your profile, then enter its password.')).toBeInTheDocument();
    expect(screen.getByText(/Need another profile\? Sign in, then add it in Setup › Profiles\./)).toBeInTheDocument();
    expect(screen.getByText(/Everyone on your home network can see these names; the passwords keep the profiles apart\./)).toBeInTheDocument();
  });

  it('arrow_keys_move_the_selection', async () => {
    setViewportWidth(1280);
    signInApi(['alex', 'kid', 'maria']).install();
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('radio', { name: 'alex' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'kid' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'kid' })).toHaveFocus();
    expect(screen.getByLabelText('Password for kid')).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'maria' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'maria' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'maria' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'alex' })).toHaveAttribute('tabindex', '-1');
  });

  it('strip_buttons_only_on_a_desktop', async () => {
    setViewportWidth(1280);
    signInApi(['alex', 'maria']).install();
    const view = renderApp();
    expect(await screen.findByRole('button', { name: 'Previous profiles' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next profiles' })).toBeInTheDocument();
    view.unmount();
    setViewportWidth(390);
    renderApp();
    await screen.findByRole('radiogroup', { name: 'Profiles' });
    expect(screen.queryByRole('button', { name: 'Previous profiles' })).toBeNull();
    expect(screen.queryByText(/Everyone on your home network/)).toBeNull();
  });

  it('sign_in_error_is_specific', async () => {
    setViewportWidth(1280);
    const api = signInApi(['Driver'])
      .on('POST /api/auth/sign-in', (body: unknown) =>
        (body as { password: string }).password === 'locked out'
          ? { status: 429, body: { statusCode: 429, message: 'Too many failed sign-in attempts. Wait 15 minutes and try again.' } }
          : { status: 401, body: { statusCode: 401, message: 'Wrong name or password.' } }
      )
      .install();
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The password needs at least 8 characters.');
    expect(api.called('POST /api/auth/sign-in')).toBe(false);

    await user.type(screen.getByLabelText('Password for Driver'), 'wrong password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The password is wrong. Check it and try again.'));

    await user.clear(screen.getByLabelText('Password for Driver'));
    await user.type(screen.getByLabelText('Password for Driver'), 'locked out');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Wait 15 minutes'));
  });
});
