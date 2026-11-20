import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CatalogueDiff, CatalogueEntry } from '@gt7/contracts';
import { voiceDeviceId } from '../src/voice/device.ts';
import { exercise } from './fixtures.ts';
import { ApiStub, liveState, playerRig, renderApp, setViewportWidth, signedIn, USER, openLive } from './support.tsx';

const INFO = {
  retrieved: '2026-11-16T10:00:00.000Z',
  gameVersionNote: '',
  counts: { entries: { Licence: 100, 'Circuit Experience': 56, 'Brand Central': 1 }, circuits: 120, cars: 500 },
  sources: [
    { name: 'Gran Turismo Wiki', licence: 'CC BY-SA', url: 'https://gran-turismo.fandom.com' },
    { name: 'ddm999/gt7info', licence: 'MIT-0', url: 'https://github.com/ddm999/gt7info' }
  ],
  hasPrevious: false,
  previousRetrieved: null
};

function entry(id: string, name: string): CatalogueEntry {
  return { id, family: 'Licence', collection: 'B', code: null, name, track: null, circuitId: null, car: null, targets: null, sections: null, source: 'wiki' };
}

function setupApi(diff?: CatalogueDiff, ps5Ip: string | null = null): ApiStub {
  const api = signedIn(new ApiStub())
    .on('GET /api/settings', { ps5Ip, gameVersion: null })
    .on('GET /api/storage', { rawBytes: 2_000_000, profileRawBytes: 1_000_000, profileCaptures: 3 })
    .on('GET /api/catalogue/info', INFO)
    .on('PUT /api/settings/connection', (body: unknown) => ({ ps5Ip: (body as { ps5Ip: string }).ps5Ip, gameVersion: null }))
    .on('POST /api/catalogue/update/apply', { ok: true });
  if (diff) api.on('POST /api/catalogue/update/check', { token: 'token-1', diff });
  return api.install();
}

describe('setup', () => {
  it('setup_rejects_invalid_address_with_reason', async () => {
    const api = setupApi();
    renderApp({ path: '/setup' });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('PS5 address'), '10.0.0.300');
    await user.click(screen.getByRole('button', { name: 'Save and check' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This is not an IPv4 address.');
    expect(screen.getByLabelText('PS5 address')).toHaveAttribute('aria-invalid', 'true');
    expect(api.called('PUT /api/settings/connection')).toBe(false);

    await user.clear(screen.getByLabelText('PS5 address'));
    await user.type(screen.getByLabelText('PS5 address'), '10.0.0.5');
    await user.click(screen.getByRole('button', { name: 'Save and check' }));
    expect(await screen.findByText('Saved. GT7 Tutor listens for 10.0.0.5.')).toBeInTheDocument();
  });

  it('enabling_voice_here_shows_other_device_disabled', async () => {
    setupApi();
    const rig = playerRig();
    const { sockets } = renderApp({ path: '/setup#voice', player: rig.player });
    await screen.findByRole('heading', { name: 'Voice' });
    const socket = await openLive(sockets, liveState({ voiceDeviceId: 'phone', voiceReady: true }));
    expect(screen.getByText('Another device plays the voice. This device stays silent.')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Use this device for voice' }));
    await waitFor(() => expect(socket.sent).toContainEqual({ type: 'claim-voice', deviceId: voiceDeviceId(), ready: true }));
    act(() => socket.receive({ type: 'state', state: liveState({ seq: 2, voiceDeviceId: voiceDeviceId(), voiceReady: true }) }));
    expect(screen.getByText('This device plays the voice. The other device no longer plays cues.')).toBeInTheDocument();
    const test = screen.getByRole('button', { name: 'Test' });
    expect(test).toBeEnabled();
    expect(test.querySelector('[data-icon="speaker"]')).not.toBeNull();
  });

  it('catalogue_update_shows_diff_before_apply', async () => {
    const api = setupApi({ added: [entry('licence-b-11', 'New test')], removed: [], changed: [{ id: 'licence-b-1', fields: ['targets'] }], rejected: null });
    renderApp({ path: '/setup#catalogue' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Check for updates' }));
    const region = await screen.findByRole('region', { name: 'Catalogue differences' });
    expect(within(region).getByText('New test (Licence)')).toBeInTheDocument();
    expect(within(region).getByText('licence-b-1: targets')).toBeInTheDocument();
    expect(api.called('POST /api/catalogue/update/apply')).toBe(false);

    await user.click(within(region).getByRole('button', { name: 'Apply update' }));
    expect(await screen.findByText('The catalogue is updated.')).toBeInTheDocument();
    expect(api.calls.find(call => call.path === '/api/catalogue/update/apply')?.body).toEqual({ token: 'token-1' });
  });

  it('rejected_update_shows_reason_and_no_apply_action', async () => {
    setupApi({ added: [], removed: [entry('licence-b-1', 'Old test')], changed: [], rejected: 'Licence would lose 60% of its entries.' });
    renderApp({ path: '/setup#catalogue' });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText(/Licence would lose 60% of its entries/)).toBeInTheDocument();
    expect(screen.getByText(/The catalogue did not change/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply update' })).not.toBeInTheDocument();
  });
});

describe('voice test icon', () => {
  it('setup_test_icon_appears_after_the_claim', async () => {
    setupApi();
    const rig = playerRig();
    const { sockets } = renderApp({ path: '/setup#voice', player: rig.player });
    await screen.findByRole('heading', { name: 'Voice' });
    await openLive(sockets, liveState({ voiceDeviceId: null }));
    expect(screen.queryByRole('button', { name: 'Test' })).not.toBeInTheDocument();
    expect(screen.queryByText('The test appears here when this device plays the voice.')).not.toBeInTheDocument();
    expect(screen.getByText('One device plays the cues: this device, or another one with GT7 Tutor open. A phone must stay unlocked during an attempt.')).toBeInTheDocument();
    act(() => sockets.latest.receive({ type: 'state', state: liveState({ seq: 2, voiceDeviceId: voiceDeviceId(), voiceReady: true }) }));
    expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument();
    expect(screen.queryByText('The test appears here when this device plays the voice.')).not.toBeInTheDocument();
  });
});

describe('setup fixes', () => {
  it('voice_off_message_says_the_drive_screen_still_shows_the_cues', async () => {
    setupApi();
    const rig = playerRig();
    const { sockets } = renderApp({ path: '/setup#voice', player: rig.player });
    await screen.findByRole('heading', { name: 'Voice' });
    await openLive(sockets, liveState({ voiceDeviceId: voiceDeviceId(), voiceReady: true }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Turn voice off here' }));
    expect(await screen.findByText('The voice is off on this device. The Drive screen still shows the cues.')).toBeInTheDocument();
  });

  it('voice_test_reports_browser_latency_not_a_measurement', async () => {
    setupApi();
    const rig = playerRig();
    const { sockets } = renderApp({ path: '/setup#voice', player: rig.player });
    await screen.findByRole('heading', { name: 'Voice' });
    await openLive(sockets, liveState({ voiceDeviceId: voiceDeviceId(), voiceReady: true }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Test' }));
    const result = await screen.findByText(/The browser reports an output delay of 25 ms/);
    expect(result).toHaveTextContent('wireless headphones');
    expect(screen.queryByText(/Playback started/)).not.toBeInTheDocument();
  });

  it('console_saves_and_checks_with_one_icon_button', async () => {
    const api = setupApi().on('POST /api/settings/connection/check', { packets: 31, decoded: 31, durationMs: 520, carId: null });
    renderApp({ path: '/setup' });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('PS5 address'), '10.0.0.5');
    const save = screen.getByRole('button', { name: 'Save and check' });
    expect(save.querySelector('[data-icon="check"]')).not.toBeNull();
    expect(save.textContent).toBe('');
    await user.click(save);
    expect(await screen.findByText(/Receiving: 31 packets in 0.5 s/)).toBeInTheDocument();
    expect(api.calls.findIndex(call => call.path === '/api/settings/connection')).toBeLessThan(
      api.calls.findIndex(call => call.path === '/api/settings/connection/check')
    );
    expect(screen.getByText(/^checked \d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('telemetry_check_again_is_an_icon_button', async () => {
    const api = setupApi(undefined, '10.0.0.5').on('POST /api/settings/connection/check', { packets: 31, decoded: 31, durationMs: 520, carId: null });
    renderApp({ path: '/setup#console' });
    const again = await screen.findByRole('button', { name: 'Check again' });
    expect(again.querySelector('[data-icon="refresh"]')).not.toBeNull();
    await userEvent.setup().click(again);
    expect(await screen.findByText(/Receiving: 31 packets in 0.5 s/)).toBeInTheDocument();
    expect(api.called('PUT /api/settings/connection')).toBe(false);
  });

  it('reception_check_without_address_shows_the_server_reason', async () => {
    setupApi().on('POST /api/settings/connection/check', {
      status: 409,
      body: { code: 'console-address-missing', reason: 'Enter the PS5 address in Setup before a capture.' }
    });
    renderApp({ path: '/setup' });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('Enter the PS5 address in Setup before a capture.')).toBeInTheDocument();
  });
});

describe('voice after a reload', () => {
  it('voice_claimed_but_not_ready_offers_to_start_audio_again', async () => {
    setupApi();
    const rig = playerRig();
    const { sockets } = renderApp({ path: '/setup#voice', player: rig.player });
    await screen.findByRole('heading', { name: 'Voice' });
    await openLive(sockets, liveState({ voiceDeviceId: voiceDeviceId(), voiceReady: false }));
    expect(screen.getByText('The browser did not start the sound on this device. Select Use this device for voice again.')).toHaveClass('error');
    expect(document.querySelector('.setup-panel .dot')).toBeNull();
    expect(screen.getByRole('button', { name: 'Use this device for voice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn voice off here' })).toBeInTheDocument();
  });
});

function sectionNav() {
  return screen.getByRole('navigation', { name: 'Setup sections' });
}

function openSocket(sockets: ReturnType<typeof renderApp>['sockets'], overrides: Parameters<typeof liveState>[0] = {}) {
  act(() => {
    sockets.latest.open();
    sockets.latest.receive({ type: 'state', state: liveState(overrides) });
  });
}

describe('setup sections', () => {
  it('wide_setup_shows_one_section_at_a_time', async () => {
    setupApi();
    renderApp({ path: '/setup' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Console' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Voice' })).not.toBeInTheDocument();
    const nav = sectionNav();
    expect(within(nav).getAllByRole('link').map(link => link.textContent)).toEqual(['Console', 'Voice', 'Profiles', 'Preferences', 'Catalogue', 'Data']);
    expect(within(nav).getByRole('link', { name: 'Console' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Profiles' })).toHaveAttribute('href', '/setup#profiles');

    await userEvent.setup().click(within(nav).getByRole('link', { name: 'Profiles' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Profiles' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Console' })).not.toBeInTheDocument();
    expect(window.location.hash).toBe('#profiles');
    expect(within(sectionNav()).getByRole('link', { name: 'Profiles' })).toHaveAttribute('aria-current', 'page');
  });

  it('hash_opens_voice_section', async () => {
    setupApi();
    renderApp({ path: '/setup#voice' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Voice' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Console' })).not.toBeInTheDocument();
  });

  it('default_section_is_voice_without_a_voice_device_and_stays', async () => {
    setupApi(undefined, '10.0.0.5');
    const { sockets } = renderApp({ path: '/setup' });
    await waitFor(() => sockets.latest);
    openSocket(sockets, { voiceDeviceId: null });
    expect(await screen.findByRole('heading', { level: 2, name: 'Voice' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Console' })).not.toBeInTheDocument();
    act(() => sockets.latest.receive({ type: 'state', state: liveState({ seq: 2, voiceDeviceId: 'phone', voiceReady: true }) }));
    expect(screen.getByRole('heading', { level: 2, name: 'Voice' })).toBeInTheDocument();
  });

  it('default_section_is_profiles_when_ready', async () => {
    setupApi(undefined, '10.0.0.5');
    const { sockets } = renderApp({ path: '/setup' });
    await waitFor(() => sockets.latest);
    openSocket(sockets, { voiceDeviceId: 'phone', voiceReady: true });
    expect(await screen.findByRole('heading', { level: 2, name: 'Profiles' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Voice' })).not.toBeInTheDocument();
  });

  it('setup_has_no_readiness_block', async () => {
    setupApi();
    renderApp({ path: '/setup' });
    await screen.findByRole('heading', { name: 'Setup' });
    expect(screen.queryByText(/Two things are needed/)).toBeNull();
    expect(screen.queryByRole('list', { name: 'Readiness' })).toBeNull();
  });

  it('setup_menu_has_no_dots', async () => {
    setupApi();
    renderApp({ path: '/setup' });
    const nav = await screen.findByRole('navigation', { name: 'Setup sections' });
    expect(nav.querySelector('.dot')).toBeNull();
  });

  it('sections_show_the_state_as_text_without_a_dot', async () => {
    setupApi();
    const { sockets } = renderApp({ path: '/setup#console' });
    await waitFor(() => sockets.latest);
    openSocket(sockets, { voiceDeviceId: null, mode: 'idle' });
    expect(await screen.findByText('No telemetry now. It starts with a recording, a training or a check.')).toBeInTheDocument();
    expect(document.querySelector('.setup-panel .dot')).toBeNull();
  });

  it('server_not_answering_is_red_text', async () => {
    setupApi();
    renderApp({ path: '/setup#console' });
    expect(await screen.findByText('GT7 Tutor does not answer. Check that it runs on the computer.')).toHaveClass('error');
  });

  it('no_packets_is_red_text', async () => {
    setupApi();
    const { sockets } = renderApp({ path: '/setup#console' });
    await waitFor(() => sockets.latest);
    openSocket(sockets, { mode: 'capturing', connection: 'disconnected' });
    expect(await screen.findByText('No packets. Check the console address.')).toHaveClass('error');
  });

  it('console_help_texts_are_new', async () => {
    setupApi();
    renderApp({ path: '/setup#console' });
    expect(await screen.findByText('GT7 Tutor asks the console for telemetry at this address. Save also checks the reception.')).toBeInTheDocument();
    expect(screen.getByText('The computer must accept UDP on port 33740. If the check finds no packets, allow the port in the firewall.')).toBeInTheDocument();
  });

  it('voice_without_a_device_has_text_without_a_dot', async () => {
    setupApi();
    const { sockets } = renderApp({ path: '/setup#voice' });
    await waitFor(() => sockets.latest);
    openSocket(sockets, { voiceDeviceId: null });
    expect(await screen.findByText('No device plays the voice.')).toBeInTheDocument();
    expect(document.querySelector('.setup-panel .dot')).toBeNull();
  });

  it('this_device_plays_the_voice_without_a_dot', async () => {
    setupApi();
    const { sockets } = renderApp({ path: '/setup#voice' });
    await waitFor(() => sockets.latest);
    openSocket(sockets, { voiceDeviceId: voiceDeviceId(), voiceReady: true });
    expect(await screen.findByText('This device plays the voice.')).toBeInTheDocument();
    expect(document.querySelector('.setup-panel .dot')).toBeNull();
  });

  it('no_setting_has_a_device_tag', async () => {
    setupApi();
    renderApp({ path: '/setup#voice' });
    expect(screen.queryByText('On this device')).toBeNull();
    expect(await screen.findByText(/Cues start earlier by this amount on this device\./)).toBeInTheDocument();
  });

  it('phone_setup_stacks_all_sections', async () => {
    setViewportWidth(390);
    setupApi();
    renderApp({ path: '/setup' });
    await screen.findByRole('heading', { level: 2, name: 'Console' });
    for (const name of ['Voice', 'Profiles', 'Preferences', 'Catalogue', 'Data']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('navigation', { name: 'Setup sections' })).not.toBeInTheDocument();
  });

  it('add_profile_form_is_collapsed', async () => {
    const api = setupApi().on('POST /api/profiles', { status: 201, body: { user: { id: 'user-2', name: 'Maria' } } });
    renderApp({ path: '/setup#profiles' });
    const user = userEvent.setup();
    const open = await screen.findByRole('button', { name: '+ Add a profile' });
    expect(open).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    await user.click(open);
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '+ Add a profile' }));
    await user.type(screen.getByLabelText('Name'), 'Maria');
    await user.type(screen.getByLabelText('Password'), 'maria password');
    await user.click(screen.getByRole('button', { name: 'Add profile' }));
    expect(await screen.findByText('Profile Maria is ready. Sign out to use it.')).toBeInTheDocument();
    expect(api.calls.find(call => call.path === '/api/profiles')?.body).toEqual({ name: 'Maria', password: 'maria password' });
  });

  it('profile_row_shows_the_signed_in_profile', async () => {
    setupApi();
    renderApp({ path: '/setup#profiles' });
    const row = await screen.findByRole('group', { name: USER.name });
    expect(within(row).getByText('Signed in on this device')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('change_password_flow', async () => {
    let reply: { status: number; body?: unknown } = { status: 204 };
    const api = setupApi().on('PUT /api/profiles/me/password', () => reply);
    renderApp({ path: '/setup#profiles' });
    const user = userEvent.setup();
    const toggle = await screen.findByRole('button', { name: 'Change password' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('At least 8 characters.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Current password'), 'old password');
    await user.type(screen.getByLabelText('New password'), 'new password 1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Password changed.')).toBeInTheDocument();
    expect(api.calls.find(call => call.path === '/api/profiles/me/password')?.body).toEqual({
      currentPassword: 'old password',
      newPassword: 'new password 1'
    });
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();

    reply = { status: 403, body: { code: 'wrong-password', reason: 'The current password is not correct.' } };
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    await user.type(screen.getByLabelText('Current password'), 'wrong password');
    await user.type(screen.getByLabelText('New password'), 'new password 2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The current password is not correct.');
  });

  it('change_password_checks_the_new_password_length', async () => {
    const api = setupApi();
    renderApp({ path: '/setup#profiles' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change password' }));
    await user.type(screen.getByLabelText('Current password'), 'old password');
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The new password needs at least 8 characters.');
    expect(api.called('PUT /api/profiles/me/password')).toBe(false);
  });

  it('restore_is_a_button_with_the_undo_icon', async () => {
    const api = setupApi().on('GET /api/catalogue/info', { ...INFO, hasPrevious: true, previousRetrieved: '2026-11-02T10:00:00.000Z' });
    api.on('POST /api/catalogue/update/restore', { ok: true });
    renderApp({ path: '/setup#catalogue' });
    expect(await screen.findByText('2 November 2026. The last update changed the catalogue.')).toBeInTheDocument();
    const restore = screen.getByRole('button', { name: 'Restore' });
    expect(restore).toHaveClass('btn');
    expect(restore.querySelector('[data-icon="undo"]')).not.toBeNull();
    await userEvent.setup().click(restore);
    expect(await screen.findByText('The previous catalogue is active again.')).toBeInTheDocument();
  });

  it('catalogue_check_is_remembered_on_this_device', async () => {
    setupApi({ added: [], removed: [], changed: [], rejected: null });
    const first = renderApp({ path: '/setup#catalogue' });
    expect(await screen.findByText('Not checked on this device yet.')).toBeInTheDocument();
    const check = screen.getByRole('button', { name: 'Check for updates' });
    expect(check.querySelector('[data-icon="refresh"]')).not.toBeNull();
    await userEvent.setup().click(check);
    expect(await screen.findByText(/^Last checked \d{1,2} \w+ \d{4}, \d{2}:\d{2}:\d{2}\. No changes\. On this device\.$/)).toBeInTheDocument();
    const stored = JSON.parse(window.localStorage.getItem('gt7.catalogueCheck')!);
    expect(stored.result).toBe('No changes.');
    first.unmount();
    renderApp({ path: '/setup#catalogue' });
    expect(await screen.findByText(/^Last checked .* No changes\. On this device\.$/)).toBeInTheDocument();
  });

  it('catalogue_version_row_shows_the_date', async () => {
    setupApi();
    renderApp({ path: '/setup#catalogue' });
    expect(await screen.findByText('16 November 2026')).toBeInTheDocument();
    expect(screen.getByText('Catalogue version')).toBeInTheDocument();
  });

  it('game_version_saves_with_an_icon_button', async () => {
    const api = setupApi().on('PUT /api/settings/game-version', { ps5Ip: null, gameVersion: '1.65' });
    renderApp({ path: '/setup#preferences' });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('GT7 version'), '1.65');
    const save = screen.getByRole('button', { name: 'Save the game version' });
    expect(save.querySelector('[data-icon="check"]')).not.toBeNull();
    await user.click(save);
    expect(await screen.findByText(/Saved: 1.65/)).toBeInTheDocument();
    expect(api.called('PUT /api/settings/game-version')).toBe(true);
  });

  it('no_restore_without_a_previous_catalogue', async () => {
    setupApi();
    renderApp({ path: '/setup#catalogue' });
    await screen.findByRole('button', { name: 'Check for updates' });
    expect(screen.queryByRole('button', { name: 'Restore the previous catalogue' })).not.toBeInTheDocument();
  });

  it('catalogue_counts_follow_the_family_order', async () => {
    setupApi().on('GET /api/catalogue/info', { ...INFO, counts: { ...INFO.counts, entries: { 'Brand Central': 20, Licence: 100, 'Circuit Experience': 58 } } });
    renderApp({ path: '/setup#catalogue' });
    await screen.findByText('Brand Central');
    const labels = [...document.querySelectorAll('.catalogue-counts dt')].map(term => term.textContent);
    expect(labels).toEqual(['Licence', 'Circuit Experience', 'Brand Central', 'Circuit layouts', 'Cars']);
  });

  it('theme_switch_has_labels_in_setup', async () => {
    setupApi();
    renderApp({ path: '/setup#preferences' });
    const group = await screen.findByRole('radiogroup', { name: 'Theme' });
    expect(within(group).getAllByRole('radio').map(radio => radio.textContent)).toEqual(['System', 'Light', 'Dark']);
  });

  it('data_section_links_delete_history', async () => {
    setupApi();
    renderApp({ path: '/setup#data' });
    expect(await screen.findByRole('link', { name: 'Delete history' })).toHaveAttribute('href', '/setup/delete-history');
    expect(screen.getByRole('button', { name: 'Clean up captures' })).toBeInTheDocument();
  });

  it('no_delete_button_ends_with_an_ellipsis', async () => {
    setupApi();
    renderApp({ path: '/setup#data' });
    await screen.findByRole('link', { name: 'Delete history' });
    for (const control of [...screen.getAllByRole('button'), ...screen.getAllByRole('link')]) expect(control.textContent).not.toMatch(/…$/);
  });

  it('profile_delete_button_has_no_ellipsis', async () => {
    setupApi();
    renderApp({ path: '/setup#profiles' });
    await screen.findByRole('button', { name: 'Delete profile' });
    for (const button of screen.getAllByRole('button')) expect(button.textContent).not.toMatch(/…$/);
  });

  it('cleanup_confirm_button_says_clean_up_captures', async () => {
    setupApi();
    renderApp({ path: '/setup#data' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Clean up captures' }));
    expect(screen.getByRole('button', { name: 'Clean up captures' })).toBeInTheDocument();
    expect(screen.queryByText('Remove unused capture data')).not.toBeInTheDocument();
  });

  it('no_switch_profile_in_setup_or_menu', async () => {
    setupApi();
    renderApp({ path: '/setup#profiles' });
    await screen.findByRole('heading', { level: 2, name: 'Profiles' });
    expect(screen.queryByText(/Switch profile/i)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Profile Driver' }));
    expect(within(screen.getByRole('menu')).queryByText(/Switch profile/i)).not.toBeInTheDocument();
  });
});

describe('screen updates', () => {
  it('preferences_set_screen_updates', async () => {
    setupApi();
    const { sockets } = renderApp({ path: '/setup#preferences' });
    await waitFor(() => sockets.latest);
    act(() => sockets.latest.open());
    const group = await screen.findByRole('radiogroup', { name: 'Screen updates while driving' });
    expect(within(group).getAllByRole('radio').map(radio => radio.textContent)).toEqual(['15/s', '30/s', '60/s']);
    expect(within(group).getByRole('radio', { name: '15 per second' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText('On this device')).not.toBeInTheDocument();
    expect(screen.getByText(/The voice cues themselves are sent at once, whatever you choose\./)).toBeInTheDocument();
    await userEvent.setup().click(within(group).getByRole('radio', { name: '60 per second' }));
    expect(within(group).getByRole('radio', { name: '60 per second' })).toHaveAttribute('aria-checked', 'true');
    expect(window.localStorage.getItem('gt7.stateRate')).toBe('60');
    expect(sockets.latest.sent).toContainEqual({ type: 'state-rate', perSecond: 60 });
  });

  it('socket_sends_stored_state_rate_on_open', async () => {
    window.localStorage.setItem('gt7.stateRate', '30');
    setupApi();
    const { sockets } = renderApp({ path: '/setup#preferences' });
    await waitFor(() => sockets.latest);
    act(() => sockets.latest.open());
    expect(sockets.latest.sent).toContainEqual({ type: 'state-rate', perSecond: 30 });
    expect(within(await screen.findByRole('radiogroup', { name: 'Screen updates while driving' })).getByRole('radio', { name: '30 per second' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  function deleteProfileApi(reply: { status: number; body: unknown }) {
    let signedOut = false;
    const api = setupApi()
      .on('GET /api/auth/state', () => (signedOut ? { hasUsers: true, user: null } : { hasUsers: true, user: USER }))
      .on('GET /api/exercises', [exercise({ attemptCount: 6, referenceCount: 2 }), exercise({ id: 'e0000000-0000-4000-8000-000000000002', attemptCount: 0 })])
      .on('POST /api/profiles/me/delete', () => {
        if (reply.status === 200) signedOut = true;
        return reply;
      });
    return api;
  }

  it('delete_profile_confirms_with_password', async () => {
    const api = deleteProfileApi({ status: 200, body: { exercises: 2, attempts: 6, references: 2, cleanup: null } });
    renderApp({ path: '/setup#profiles' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete profile' }));
    const dialog = screen.getByRole('alertdialog', { name: `Delete the profile ${USER.name}?` });
    expect(dialog).toHaveTextContent('Everything of this profile goes:');
    expect(await within(dialog).findByText(/2 exercises/)).toBeInTheDocument();
    expect(dialog).toHaveTextContent('2 exercises with their references');
    expect(dialog).toHaveTextContent('6 attempts with their cues and differences');
    expect(dialog).toHaveTextContent('3 captures on this computer, 1.0 MB');
    expect(dialog).toHaveTextContent('the sign-in on every device');
    expect(dialog).toHaveTextContent('Other profiles and the settings of this computer stay. You cannot undo this.');
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    const confirm = within(dialog).getByRole('button', { name: 'Delete profile' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(`Enter the password of ${USER.name} to confirm`), 'correct horse');
    await user.click(confirm);
    await waitFor(() => expect(api.called('POST /api/profiles/me/delete')).toBe(true));
    expect(api.calls.find(call => call.path === '/api/profiles/me/delete')!.body).toEqual({ password: 'correct horse' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Who is driving?' })).toBeInTheDocument();
  });

  it('delete_profile_wrong_password_shows_message', async () => {
    setViewportWidth(390);
    deleteProfileApi({ status: 403, body: { code: 'wrong-password', reason: 'The password is not correct.' } });
    renderApp({ path: '/setup#profiles' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete profile' }));
    const dialog = screen.getByRole('alertdialog');
    await user.type(within(dialog).getByLabelText(`Enter the password of ${USER.name} to confirm`), 'wrong one');
    await user.click(within(dialog).getByRole('button', { name: 'Delete profile' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The password is not correct.');
    expect(screen.queryByRole('heading', { level: 1, name: 'Who is driving?' })).not.toBeInTheDocument();
  });

  it('delete_profile_busy_shows_message', async () => {
    deleteProfileApi({ status: 409, body: { code: 'busy', reason: 'Busy.' } });
    renderApp({ path: '/setup#profiles' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete profile' }));
    const dialog = screen.getByRole('alertdialog');
    await user.type(within(dialog).getByLabelText(`Enter the password of ${USER.name} to confirm`), 'correct horse');
    await user.click(within(dialog).getByRole('button', { name: 'Delete profile' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Stop the training or the recording first.');
  });

  it('delete_profile_names_one_exercise_and_one_attempt', async () => {
    setupApi().on('GET /api/exercises', [exercise({ attemptCount: 1, referenceCount: 1 })]);
    renderApp({ path: '/setup#profiles' });
    await userEvent.click(await screen.findByRole('button', { name: 'Delete profile' }));
    const dialog = screen.getByRole('alertdialog');
    expect(await within(dialog).findByText('1 exercise')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('1 exercise with its references');
    expect(dialog).toHaveTextContent('1 attempt with its cues and differences');
  });
});
