import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Exercise } from '@gt7/contracts';
import { voiceDeviceId } from '../src/voice/device.ts';
import { exercise } from './fixtures.ts';
import { ApiStub, liveState, playerRig, renderApp, setViewportWidth, signedIn, USER } from './support.tsx';

function getReadyApi(ps5Ip: string | null, exercises: Exercise[] = []): ApiStub {
  let address = ps5Ip;
  return signedIn(new ApiStub())
    .on('GET /api/exercises', exercises)
    .on('GET /api/progress', { collections: [], exercises: [] })
    .on('GET /api/catalogue', [])
    .on('GET /api/settings', () => ({ ps5Ip: address, gameVersion: null }))
    .on('PUT /api/settings/connection', (body: unknown) => {
      address = (body as { ps5Ip: string }).ps5Ip;
      return { ps5Ip: address, gameVersion: null };
    })
    .on('POST /api/settings/connection/check', { status: 201, body: { packets: 120, decoded: 120, durationMs: 2000, carId: null } })
    .install();
}

function step(name: RegExp): HTMLElement {
  return screen.getByRole('listitem', { name });
}

describe('get ready', () => {
  it('steps_follow_order_console_first', async () => {
    setViewportWidth(1440);
    getReadyApi(null);
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'Get ready to train' })).toBeInTheDocument();
    expect(screen.getByText(`Welcome, ${USER.name}`)).toBeInTheDocument();
    expect(screen.getByText('0 of 3 ready')).toBeInTheDocument();
    const steps = within(screen.getByRole('list', { name: 'Three steps' })).getAllByRole('listitem');
    expect(steps.map(item => item.querySelector('h2')?.textContent)).toEqual(['Connect the console', 'Choose the device for the voice', 'Pick your first exercise']);
    expect(within(step(/Connect the console/)).getByLabelText('PS5 address')).toBeInTheDocument();
    expect(steps[0]).toHaveAttribute('aria-current', 'step');
    expect(within(step(/Choose the device/)).queryByRole('button')).toBeNull();
    expect(within(step(/Pick your first/)).queryByRole('link')).toBeNull();
  });

  it('saving_address_checks_reception_and_opens_voice', async () => {
    setViewportWidth(1440);
    const api = getReadyApi(null);
    renderApp();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('PS5 address'), '192.168.1.40');
    await user.click(screen.getByRole('button', { name: 'Save and check' }));
    await waitFor(() => expect(api.called('POST /api/settings/connection/check')).toBe(true));
    expect(api.calls.findIndex(call => call.path === '/api/settings/connection')).toBeLessThan(
      api.calls.findIndex(call => call.path === '/api/settings/connection/check')
    );
    expect(await within(step(/Connect the console/)).findByText('Receiving telemetry')).toBeInTheDocument();
    expect(within(step(/Choose the device/)).getByRole('button', { name: 'Use this device for voice' })).toBeInTheDocument();
    expect(step(/Choose the device/)).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('1 of 3 ready')).toBeInTheDocument();
  });

  it('console_step_uses_an_icon_button', async () => {
    setViewportWidth(1440);
    getReadyApi(null);
    renderApp();
    await screen.findByLabelText('PS5 address');
    const save = screen.getByRole('button', { name: 'Save and check' });
    expect(save.textContent).toBe('');
    expect(save.querySelector('[data-icon="check"]')).not.toBeNull();
  });

  it('no_packets_does_not_block_the_next_step', async () => {
    setViewportWidth(1440);
    getReadyApi(null).on('POST /api/settings/connection/check', { status: 201, body: { packets: 0, decoded: 0, durationMs: 2000, carId: null } });
    renderApp();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('PS5 address'), '192.168.1.40');
    await user.click(screen.getByRole('button', { name: 'Save and check' }));
    expect(await within(step(/Connect the console/)).findByText('Address saved, no telemetry yet')).toBeInTheDocument();
    expect(step(/Choose the device/)).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('1 of 3 ready')).toBeInTheDocument();
  });

  it('failed_check_does_not_block_the_next_step', async () => {
    setViewportWidth(1440);
    getReadyApi(null).on('POST /api/settings/connection/check', { status: 409, body: { code: 'busy', reason: 'A recording is running.' } });
    renderApp();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('PS5 address'), '192.168.1.40');
    await user.click(screen.getByRole('button', { name: 'Save and check' }));
    expect(await within(step(/Connect the console/)).findByText('Address saved, no telemetry yet')).toBeInTheDocument();
    expect(step(/Choose the device/)).toHaveAttribute('aria-current', 'step');
  });

  it('wrong_address_stays_on_the_console_step', async () => {
    setViewportWidth(1440);
    const api = getReadyApi(null);
    renderApp();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('PS5 address'), '300.1.1.1');
    await user.click(screen.getByRole('button', { name: 'Save and check' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This is not an IPv4 address');
    expect(api.called('PUT /api/settings/connection')).toBe(false);
  });

  it('voice_later_moves_to_exercise_step', async () => {
    setViewportWidth(390);
    getReadyApi('192.168.1.40');
    renderApp();
    const user = userEvent.setup();
    const later = await screen.findByRole('button', { name: 'Set up the voice later' });
    expect(later).toHaveClass('btn');
    await user.click(later);
    expect(window.localStorage.getItem(`gt7.getReady.voiceLater.${USER.id}`)).toBe('1');
    expect(within(step(/Choose the device/)).getByText('Later')).toBeInTheDocument();
    expect(step(/Pick your first/)).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('1 of 3 ready')).toBeInTheDocument();
  });

  it('claim_sends_claim_voice', async () => {
    setViewportWidth(390);
    getReadyApi('192.168.1.40');
    const rig = playerRig();
    const { sockets } = renderApp({ player: rig.player });
    const button = await screen.findByRole('button', { name: 'Use this device for voice' });
    expect(within(step(/Choose the device/)).queryByRole('button', { name: /Test/ })).toBeNull();
    const socket = await waitFor(() => sockets.latest);
    act(() => {
      socket.open();
      socket.receive({ type: 'state', state: liveState() });
    });
    await userEvent.setup().click(button);
    await waitFor(() => expect(socket.sent).toContainEqual({ type: 'claim-voice', deviceId: voiceDeviceId(), ready: true }));
    act(() => socket.receive({ type: 'state', state: liveState({ seq: 2, voiceDeviceId: voiceDeviceId(), voiceReady: true }) }));
    expect(within(step(/Choose the device/)).getByText('This device')).toBeInTheDocument();
    const test = within(step(/Choose the device/)).getByRole('button', { name: 'Test' });
    expect(test.querySelector('[data-icon="speaker"]')).not.toBeNull();
    const played = vi.spyOn(rig.player, 'test');
    await userEvent.setup().click(test);
    expect(played).toHaveBeenCalledTimes(1);
    expect(screen.getByText('2 of 3 ready')).toBeInTheDocument();
  });

  it('claim_preloads_the_voice_check_clip', async () => {
    setViewportWidth(1440);
    getReadyApi('192.168.1.40');
    const rig = playerRig();
    const { sockets } = renderApp({ player: rig.player });
    const button = await screen.findByRole('button', { name: 'Use this device for voice' });
    const socket = await waitFor(() => sockets.latest);
    act(() => {
      socket.open();
      socket.receive({ type: 'state', state: liveState() });
    });
    await userEvent.setup().click(button);
    await waitFor(() => expect(socket.sent).toContainEqual({ type: 'claim-voice', deviceId: voiceDeviceId(), ready: true }));
    expect(rig.player.hasClip('voice-check')).toBe(true);
  });

  it('voice_step_texts_name_no_device_type', async () => {
    setViewportWidth(1440);
    getReadyApi('192.168.1.40');
    renderApp();
    const voiceStep = await screen.findByRole('listitem', { name: /Choose the device/ });
    expect(within(voiceStep).getByText('One device plays the cues: this device, or another one with GT7 Tutor open. A phone must stay unlocked during an attempt.')).toBeInTheDocument();
    expect(within(voiceStep).getAllByRole('button').map(button => button.textContent)).toEqual(['Use this device for voice', 'Set up the voice later']);
  });

  it('exercise_step_links_add_exercise', async () => {
    setViewportWidth(1440);
    window.localStorage.setItem(`gt7.getReady.voiceLater.${USER.id}`, '1');
    getReadyApi('192.168.1.40');
    renderApp();
    const link = await within(await screen.findByRole('listitem', { name: /Pick your first/ })).findByRole('link', { name: 'Add an exercise' });
    expect(link).toHaveAttribute('href', '/exercises/add');
  });

  it('exercise_step_done_when_exercises_exist', async () => {
    setViewportWidth(1440);
    getReadyApi(null, [exercise()]);
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'Get ready to train' })).toBeInTheDocument();
    expect(step(/Pick your first/)).toHaveTextContent('Done');
    expect(screen.getByText('1 of 3 ready')).toBeInTheDocument();
  });
});
