import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AppInfo } from '@gt7/contracts';
import { exercise, exerciseApi, rememberExercise, EXERCISE_ID } from './fixtures.ts';
import { ApiStub, liveState, renderApp, setViewportWidth, signedIn, openLive, el, findEl, findIconButton, maybeIconButton } from './support.tsx';

const DEMO_LABEL = 'Demo: recorded data, no console';
const DEMO: AppInfo = { demo: { profileName: 'demo', password: 'demodemo', ready: true }, consoleRequired: false };
const ARMED = { captureId: 'cap-9', exerciseId: EXERCISE_ID, referenceId: 'ref-demo' };

function withDemo(api: ApiStub, info: AppInfo = DEMO): ApiStub {
  return api.on('GET /api/app-info', info);
}


const DRIVE_PATH = `/exercises/${EXERCISE_ID}/drive`;

function driveDemoApi(): ApiStub {
  rememberExercise();
  return withDemo(exerciseApi(exercise({ step: 3 })))
    .on('POST /api/demo/attempt', { status: 201, body: { fixture: 'ce-clean' } })
    .on('POST /api/training/arm', { status: 201, body: ARMED })
    .install();
}

async function openStage() {
  const view = renderApp({ path: DRIVE_PATH });
  await findEl('nav.nav');
  await openLive(view.sockets, liveState({ mode: 'armed', connection: 'connected', exerciseId: EXERCISE_ID, referenceId: 'ref-demo' }));
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
    driveDemoApi();
    renderApp({ path: DRIVE_PATH });
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
    expect(await screen.findByRole('radio', { name: /demo$/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Password for demo')).toHaveValue('demodemo');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(api.calls.find(call => call.path === '/api/auth/sign-in')?.body).toEqual({ name: 'demo', password: 'demodemo' }));
  });

  it('drive_demo_text_says_what_the_demo_does', async () => {
    driveDemoApi();
    await openStage();
    const help = await screen.findByText('The demo replays a recorded attempt in real time.');
    expect(screen.getByText(/^It takes about 40 s\. This screen shows the cues, and the voice device also says them\. First cue after the start: /)).toHaveClass('race-note');
    expect(help.closest('.drive-stage')).not.toBeNull();
    expect(screen.queryByText(/GT7 Tutor finds the start and the finish/)).toBeNull();
  });

  it('setup_has_no_console_edit_and_no_catalogue_update_in_demo', async () => {
    setupApi(DEMO);
    renderApp({ path: '/setup#console' });
    expect(await screen.findByText('Demo mode uses recorded data.')).toBeInTheDocument();
    expect(screen.queryByLabelText('PS5 address')).not.toBeInTheDocument();
    expect(within(el('nav.setup-nav')).queryByRole('link', { name: 'Catalogue' })).not.toBeInTheDocument();
    expect(maybeIconButton('Check for updates')).not.toBeInTheDocument();
  });

  it('demo_hides_change_password', async () => {
    setupApi(DEMO);
    renderApp({ path: '/setup#profiles' });
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change password' })).not.toBeInTheDocument();
  });

  it('delete_profile_hidden_in_demo', async () => {
    setupApi(DEMO);
    renderApp({ path: '/setup#profiles' });
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete profile…' })).not.toBeInTheDocument();
  });

  it('no_demo_element_outside_demo_mode', async () => {
    setupApi({ demo: null, consoleRequired: true });
    renderApp({ path: '/setup' });
    expect(await screen.findByLabelText('PS5 address')).toBeInTheDocument();
    await userEvent.setup().click(within(el('nav.setup-nav')).getByRole('link', { name: 'Catalogue' }));
    expect(await findIconButton('Check for updates')).toBeInTheDocument();
    expect(screen.queryByText(DEMO_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText('Demo mode uses recorded data.')).not.toBeInTheDocument();
  });

  it('drive_outside_demo_mode_has_no_demo_attempt', async () => {
    setViewportWidth(390);
    rememberExercise();
    const api = withDemo(exerciseApi(exercise({ step: 3 })), { demo: null, consoleRequired: true })
      .on('POST /api/training/arm', { status: 201, body: ARMED })
      .install();
    const view = renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    await openLive(view.sockets, liveState({ voiceDeviceId: 'other-device', voiceReady: true }));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Drive' }));
    await waitFor(() => expect(api.called('POST /api/training/arm')).toBe(true));
    expect(api.called('POST /api/demo/attempt')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Play a demo attempt' })).not.toBeInTheDocument();
  });

  it('drive_in_demo_does_not_ask_for_the_console_after_the_replay', async () => {
    setViewportWidth(390);
    driveDemoApi();
    const view = renderApp({ path: DRIVE_PATH });
    await findEl('nav.nav');
    await openLive(view.sockets, liveState({ mode: 'armed', connection: 'disconnected', exerciseId: EXERCISE_ID }));
    expect(await screen.findByText('The demo attempt has ended. Select Stop training, then select Drive.')).toBeInTheDocument();
    expect(screen.queryByText(/Check that GT7 is running/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Check the console address/)).not.toBeInTheDocument();
  });
});
