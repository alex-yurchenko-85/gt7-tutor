import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { CatalogueDiff, CatalogueEntry } from '@gt7/contracts';
import { voiceDeviceId } from '../src/voice/device.ts';
import { ApiStub, liveState, playerRig, renderApp, setViewportWidth, signedIn } from './support.tsx';

const INFO = {
  retrieved: '2026-11-16T10:00:00.000Z',
  gameVersionNote: '',
  counts: { entries: { Licence: 100, 'Circuit Experience': 56, 'Brand Experience': 1 }, circuits: 120, cars: 500 },
  sources: [
    { name: 'Gran Turismo Wiki', licence: 'CC BY-SA', url: 'https://gran-turismo.fandom.com' },
    { name: 'ddm999/gt7info', licence: 'MIT-0', url: 'https://github.com/ddm999/gt7info' }
  ],
  hasPrevious: false
};

function entry(id: string, name: string): CatalogueEntry {
  return { id, family: 'Licence', collection: 'B', code: null, name, track: null, circuitId: null, car: null, targets: null, sections: null, source: 'wiki', support: 'unverified' };
}

function setupApi(diff?: CatalogueDiff): ApiStub {
  const api = signedIn(new ApiStub())
    .on('GET /api/settings', { ps5Ip: null, gameVersion: null })
    .on('GET /api/storage', { rawBytes: 2_000_000, profileRawBytes: 1_000_000, profileCaptures: 3 })
    .on('GET /api/catalogue/info', INFO)
    .on('PUT /api/settings/connection', (body: unknown) => ({ ps5Ip: (body as { ps5Ip: string }).ps5Ip, gameVersion: null }))
    .on('POST /api/catalogue/update/apply', { ok: true });
  if (diff) api.on('POST /api/catalogue/update/check', { token: 'token-1', diff });
  return api.install();
}

describe('setup', () => {
  it('setup_rejects_invalid_address_with_reason', async () => {
    setViewportWidth(1280);
    const api = setupApi();
    renderApp({ path: '/setup' });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('PS5 address'), '10.0.0.300');
    await user.click(screen.getByRole('button', { name: 'Save address' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This is not an IPv4 address.');
    expect(screen.getByLabelText('PS5 address')).toHaveAttribute('aria-invalid', 'true');
    expect(api.called('PUT /api/settings/connection')).toBe(false);

    await user.clear(screen.getByLabelText('PS5 address'));
    await user.type(screen.getByLabelText('PS5 address'), '10.0.0.5');
    await user.click(screen.getByRole('button', { name: 'Save address' }));
    expect(await screen.findByText('Saved. GT7 Tutor listens for 10.0.0.5.')).toBeInTheDocument();
  });

  it('enabling_voice_here_shows_other_device_disabled', async () => {
    setViewportWidth(1280);
    setupApi();
    const rig = playerRig();
    const { sockets } = renderApp({ path: '/setup', player: rig.player });
    await screen.findByRole('heading', { name: 'Voice' });
    const socket = await waitFor(() => sockets.latest);
    act(() => {
      socket.open();
      socket.receive({ type: 'state', state: liveState({ voiceDeviceId: 'phone', voiceReady: true }) });
    });
    expect(screen.getByText('Voice is on another device. This device stays silent.')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Use this device for voice' }));
    await waitFor(() => expect(socket.sent).toContainEqual({ type: 'claim-voice', deviceId: voiceDeviceId(), ready: true }));
    act(() => socket.receive({ type: 'state', state: liveState({ seq: 2, voiceDeviceId: voiceDeviceId(), voiceReady: true }) }));
    expect(screen.getByText('This device plays the voice. The other device no longer plays cues.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run voice test' })).toBeEnabled();
  });

  it('catalogue_update_shows_diff_before_apply', async () => {
    setViewportWidth(1280);
    const api = setupApi({ added: [entry('licence-b-11', 'New test')], removed: [], changed: [{ id: 'licence-b-1', fields: ['targets'] }], rejected: null });
    renderApp({ path: '/setup' });
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
    setViewportWidth(1280);
    setupApi({ added: [], removed: [entry('licence-b-1', 'Old test')], changed: [], rejected: 'Licence would lose 60% of its entries.' });
    renderApp({ path: '/setup' });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText(/Licence would lose 60% of its entries/)).toBeInTheDocument();
    expect(screen.getByText(/The catalogue did not change/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply update' })).not.toBeInTheDocument();
  });
});

describe('setup fixes', () => {
  it('voice_test_reports_browser_latency_not_a_measurement', async () => {
    setViewportWidth(1280);
    setupApi();
    const rig = playerRig();
    const { sockets } = renderApp({ path: '/setup', player: rig.player });
    await screen.findByRole('heading', { name: 'Voice' });
    await waitFor(() => sockets.latest);
    act(() => {
      sockets.latest.open();
      sockets.latest.receive({ type: 'state', state: liveState({ voiceDeviceId: voiceDeviceId(), voiceReady: true }) });
    });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Run voice test' }));
    const result = await screen.findByText(/The browser reports an output delay of 25 ms/);
    expect(result).toHaveTextContent('wireless headphones');
    expect(screen.queryByText(/Playback started/)).not.toBeInTheDocument();
  });

  it('reception_check_is_available_after_saving_without_reload', async () => {
    setViewportWidth(1280);
    setupApi().on('POST /api/settings/connection/check', { packets: 31, decoded: 31, durationMs: 520, carId: null });
    renderApp({ path: '/setup' });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('PS5 address'), '10.0.0.5');
    await user.click(screen.getByRole('button', { name: 'Save address' }));
    await screen.findByText('Saved. GT7 Tutor listens for 10.0.0.5.');
    await user.click(screen.getByRole('button', { name: 'Check reception' }));
    expect(await screen.findByText(/Receiving: 31 packets in 0.5 s/)).toBeInTheDocument();
  });

  it('reception_check_without_address_shows_the_server_reason', async () => {
    setViewportWidth(1280);
    setupApi().on('POST /api/settings/connection/check', {
      status: 409,
      body: { code: 'console-address-missing', reason: 'Enter the PS5 address in Setup before a capture.' }
    });
    renderApp({ path: '/setup' });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Check reception' }));
    expect(await screen.findByText('Enter the PS5 address in Setup before a capture.')).toBeInTheDocument();
  });
});

describe('voice after a reload', () => {
  it('voice_claimed_but_not_ready_offers_to_start_audio_again', async () => {
    setViewportWidth(1280);
    setupApi();
    const rig = playerRig();
    const { sockets } = renderApp({ path: '/setup', player: rig.player });
    await screen.findByRole('heading', { name: 'Voice' });
    await waitFor(() => sockets.latest);
    act(() => {
      sockets.latest.open();
      sockets.latest.receive({ type: 'state', state: liveState({ voiceDeviceId: voiceDeviceId(), voiceReady: false }) });
    });
    expect(screen.getByText(/The browser has not started audio on this device/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use this device for voice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn voice off here' })).toBeInTheDocument();
  });
});
