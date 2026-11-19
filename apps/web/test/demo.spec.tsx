import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AppInfo } from '@gt7/contracts';
import { exercise, exerciseApi, rememberExercise } from './fixtures.ts';
import { ApiStub, liveState, renderApp, setViewportWidth, signedIn } from './support.tsx';

const DEMO_LABEL = 'Demo: recorded data, no console';
const DEMO: AppInfo = { demo: { profileName: 'demo', password: 'demodemo', ready: true }, consoleRequired: false };
const ARMED = { captureId: 'cap-9', exerciseId: 'e0000000-0000-4000-8000-000000000001', referenceId: 'ref-demo', mode: 'guided' };

function withDemo(api: ApiStub, info: AppInfo = DEMO): ApiStub {
  return api.on('GET /api/app-info', info);
}

function driveDemoApi(): ApiStub {
  rememberExercise();
  return withDemo(exerciseApi(exercise({ step: 3 })))
    .on('POST /api/demo/attempt', { status: 201, body: { fixture: 'ce-clean' } })
    .on('POST /api/training/arm', { status: 201, body: ARMED })
    .install();
}

async function openDrive(voiceReady: boolean) {
  const view = renderApp({ path: '/drive' });
  await screen.findByRole('heading', { name: 'Drive' });
  const socket = await waitFor(() => view.sockets.latest);
  act(() => {
    socket.open();
    socket.receive({ type: 'state', state: liveState(voiceReady ? { voiceDeviceId: 'other-device', voiceReady: true } : {}) });
  });
  return view;
}

function setupApi(info: AppInfo): ApiStub {
  return withDemo(signedIn(new ApiStub()), info)
    .on('GET /api/settings', { ps5Ip: null, gameVersion: null })
    .on('GET /api/storage', { rawBytes: 0, profileRawBytes: 0, profileCaptures: 0 })
    .on('GET /api/catalogue/info', {
      retrieved: '2026-11-16T10:00:00.000Z',
      gameVersionNote: '',
      counts: { entries: {}, circuits: 0, cars: 0 },
      sources: [],
      hasPrevious: false,
      previousRetrieved: null
    })
    .install();
}

describe('demo mode', () => {
  it('demo_label_shows_on_every_view', async () => {
    setViewportWidth(1280);
    driveDemoApi();
    renderApp({ path: '/drive' });
    expect(await screen.findByText(DEMO_LABEL)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('link', { name: 'Setup' }));
    expect(screen.getByText(DEMO_LABEL)).toBeInTheDocument();
  });

  it('demo_sign_in_selects_demo_and_fills_the_password', async () => {
    setViewportWidth(390);
    const api = withDemo(new ApiStub().on('GET /api/auth/state', { hasUsers: true, user: null }).on('GET /api/auth/profiles', [{ name: 'demo' }]))
      .on('POST /api/auth/sign-in', { status: 200, body: { user: { id: 'u', name: 'demo' } } })
      .install();
    renderApp();
    expect(await screen.findByText(DEMO_LABEL)).toBeInTheDocument();
    expect(screen.getByText('demodemo')).toBeInTheDocument();
    expect(await screen.findByRole('radio', { name: 'demo' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Password for demo')).toHaveValue('demodemo');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(api.calls.find(call => call.path === '/api/auth/sign-in')?.body).toEqual({ name: 'demo', password: 'demodemo' }));
  });

  it('play_a_demo_attempt_selects_then_arms_guided', async () => {
    setViewportWidth(390);
    const api = driveDemoApi();
    await openDrive(true);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Play a demo attempt' }));
    await waitFor(() => expect(api.called('POST /api/training/arm')).toBe(true));
    const order = api.calls.map(call => `${call.method} ${call.path}`).filter(route => route === 'POST /api/demo/attempt' || route === 'POST /api/training/arm');
    expect(order).toEqual(['POST /api/demo/attempt', 'POST /api/training/arm']);
    expect(api.calls.find(call => call.path === '/api/training/arm')?.body).toEqual({ exerciseId: 'e0000000-0000-4000-8000-000000000001', mode: 'guided' });
  });

  it('play_a_demo_attempt_asks_to_confirm_without_voice', async () => {
    setViewportWidth(390);
    const api = driveDemoApi();
    await openDrive(false);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Play a demo attempt' }));
    expect(api.called('POST /api/demo/attempt')).toBe(false);
    expect(await screen.findByRole('alert')).toHaveTextContent('No device plays the voice.');
    await user.click(screen.getByRole('button', { name: 'Play without voice' }));
    await waitFor(() => expect(api.calls.find(call => call.path === '/api/training/arm')?.body).toEqual({ exerciseId: 'e0000000-0000-4000-8000-000000000001', mode: 'guided', confirmNoVoice: true }));
  });

  it('setup_has_no_console_edit_and_no_catalogue_update_in_demo', async () => {
    setViewportWidth(1280);
    setupApi(DEMO);
    renderApp({ path: '/setup#console' });
    expect(await screen.findByText('Demo mode uses recorded data.')).toBeInTheDocument();
    expect(screen.queryByLabelText('PS5 address')).not.toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Setup sections' })).queryByRole('link', { name: 'Catalogue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check for updates' })).not.toBeInTheDocument();
  });

  it('demo_hides_change_password', async () => {
    setViewportWidth(1280);
    setupApi(DEMO);
    renderApp({ path: '/setup#profiles' });
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change password' })).not.toBeInTheDocument();
  });

  it('delete_profile_hidden_in_demo', async () => {
    setViewportWidth(1280);
    setupApi(DEMO);
    renderApp({ path: '/setup#profiles' });
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete profile…' })).not.toBeInTheDocument();
  });

  it('no_demo_element_outside_demo_mode', async () => {
    setViewportWidth(1280);
    setupApi({ demo: null, consoleRequired: true });
    renderApp({ path: '/setup' });
    expect(await screen.findByLabelText('PS5 address')).toBeInTheDocument();
    await userEvent.setup().click(within(screen.getByRole('navigation', { name: 'Setup sections' })).getByRole('link', { name: 'Catalogue' }));
    expect(await screen.findByRole('button', { name: 'Check for updates' })).toBeInTheDocument();
    expect(screen.queryByText(DEMO_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText('Demo mode uses recorded data.')).not.toBeInTheDocument();
  });

  it('drive_outside_demo_mode_has_no_demo_attempt', async () => {
    setViewportWidth(390);
    rememberExercise();
    withDemo(exerciseApi(exercise({ step: 3 })), { demo: null, consoleRequired: true }).install();
    await openDrive(true);
    expect(screen.getByRole('button', { name: 'Start a guided attempt' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play a demo attempt' })).not.toBeInTheDocument();
  });

  it('drive_in_demo_does_not_ask_for_the_console_after_the_replay', async () => {
    setViewportWidth(390);
    driveDemoApi();
    const view = renderApp({ path: '/drive' });
    await screen.findByRole('heading', { name: 'Drive' });
    const socket = await waitFor(() => view.sockets.latest);
    act(() => {
      socket.open();
      socket.receive({ type: 'state', state: liveState({ mode: 'armed', connection: 'disconnected', exerciseId: 'e0000000-0000-4000-8000-000000000001', trainingMode: 'guided' }) });
    });
    expect(await screen.findByText('The recorded attempt has ended. Select Stop to play another one.')).toBeInTheDocument();
    expect(screen.queryByText(/Check that GT7 is running/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Check the console address/)).not.toBeInTheDocument();
  });
});
