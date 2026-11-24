import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Exercise } from '@gt7/contracts';
import { voiceDeviceId } from '../src/voice/device.ts';
import { exercise } from './fixtures.ts';
import { ApiStub, liveState, playerRig, renderApp, setViewportWidth, signedIn, USER, openLive, els, elWith, findElWith, iconButton } from './support.tsx';

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
  return elWith('li.ready-step', name);
}

async function connectConsole(): Promise<void> {
  await userEvent.setup().type(await screen.findByLabelText('PS5 address'), '192.168.1.40');
  await userEvent.setup().click(iconButton('Save and check'));
  await within(step(/Connect the console/)).findByText('Receiving telemetry');
}

describe('get ready', () => {
  it('steps_follow_order_console_first', async () => {
    getReadyApi(null);
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'Get ready to train' })).toBeInTheDocument();
    expect(screen.getByText(`Welcome, ${USER.name}`)).toBeInTheDocument();
    expect(screen.getByText('0 of 3 ready')).toBeInTheDocument();
    const steps = els('li.ready-step');
    expect(steps.map(item => item.querySelector('h2')?.textContent)).toEqual(['Connect the console', 'Choose the device for the voice', 'Pick your first exercise']);
    expect(within(step(/Connect the console/)).getByLabelText('PS5 address')).toBeInTheDocument();
    expect(steps[0]).toHaveAttribute('aria-current', 'step');
    expect(within(step(/Choose the device/)).queryByRole('button')).toBeNull();
    expect(within(step(/Pick your first/)).queryByRole('link')).toBeNull();
  });

  it('saving_address_checks_reception_and_opens_voice', async () => {
    const api = getReadyApi(null);
    renderApp();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('PS5 address'), '192.168.1.40');
    await user.click(iconButton('Save and check'));
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
    getReadyApi(null);
    renderApp();
    await screen.findByLabelText('PS5 address');
    const save = iconButton('Save and check');
    expect(save.textContent).toBe('');
    expect(save.querySelector('[data-icon="check"]')).not.toBeNull();
  });

  it('no_packets_does_not_block_the_next_step', async () => {
    getReadyApi(null).on('POST /api/settings/connection/check', { status: 201, body: { packets: 0, decoded: 0, durationMs: 2000, carId: null } });
    renderApp();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('PS5 address'), '192.168.1.40');
    await user.click(iconButton('Save and check'));
    expect(await within(step(/Connect the console/)).findByText('Address saved, no telemetry yet')).toBeInTheDocument();
    expect(step(/Choose the device/)).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('1 of 3 ready')).toBeInTheDocument();
  });

  it('failed_check_does_not_block_the_next_step', async () => {
    getReadyApi(null).on('POST /api/settings/connection/check', { status: 409, body: { code: 'busy' } });
    renderApp();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('PS5 address'), '192.168.1.40');
    await user.click(iconButton('Save and check'));
    expect(await within(step(/Connect the console/)).findByText('Address saved, no telemetry yet')).toBeInTheDocument();
    expect(step(/Choose the device/)).toHaveAttribute('aria-current', 'step');
  });

  it('wrong_address_stays_on_the_console_step', async () => {
    const api = getReadyApi(null);
    renderApp();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('PS5 address'), '300.1.1.1');
    await user.click(iconButton('Save and check'));
    expect(await screen.findByRole('alert')).toHaveTextContent('This is not an IPv4 address');
    expect(api.called('PUT /api/settings/connection')).toBe(false);
  });

  it('voice_later_moves_to_exercise_step', async () => {
    setViewportWidth(390);
    getReadyApi(null);
    renderApp();
    const user = userEvent.setup();
    await connectConsole();
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
    getReadyApi(null);
    const rig = playerRig();
    const { sockets } = renderApp({ player: rig.player });
    await connectConsole();
    const button = await screen.findByRole('button', { name: 'Use this device for voice' });
    expect(within(step(/Choose the device/)).queryByRole('button', { name: /Test/ })).toBeNull();
    const socket = await openLive(sockets);
    await userEvent.setup().click(button);
    await waitFor(() => expect(socket.sent).toContainEqual({ type: 'claim-voice', deviceId: voiceDeviceId(), ready: true }));
    act(() => socket.receive({ type: 'state', state: liveState({ seq: 2, voiceDeviceId: voiceDeviceId(), voiceReady: true }) }));
    expect(within(step(/Choose the device/)).getByText('This device')).toBeInTheDocument();
    const test = iconButton('Test', step(/Choose the device/));
    expect(test.querySelector('[data-icon="speaker"]')).not.toBeNull();
    const played = vi.spyOn(rig.player, 'test');
    await userEvent.setup().click(test);
    expect(played).toHaveBeenCalledTimes(1);
    expect(screen.getByText('2 of 3 ready')).toBeInTheDocument();
  });

  it('claim_preloads_the_voice_check_clip', async () => {
    getReadyApi(null);
    const rig = playerRig();
    const { sockets } = renderApp({ player: rig.player });
    await connectConsole();
    const button = await screen.findByRole('button', { name: 'Use this device for voice' });
    const socket = await openLive(sockets);
    await userEvent.setup().click(button);
    await waitFor(() => expect(socket.sent).toContainEqual({ type: 'claim-voice', deviceId: voiceDeviceId(), ready: true }));
    expect(rig.player.hasClip('voice-check')).toBe(true);
  });

  it('voice_step_texts_name_no_device_type', async () => {
    getReadyApi(null);
    renderApp();
    await connectConsole();
    const voiceStep = await findElWith('li.ready-step', /Choose the device/);
    expect(within(voiceStep).getByText('One device plays the cues: this device, or another one with GT7 Tutor open. A phone must stay unlocked during an attempt.')).toBeInTheDocument();
    expect(within(voiceStep).getAllByRole('button').map(button => button.textContent)).toEqual(['Use this device for voice', 'Set up the voice later']);
  });

  it('the_exercise_step_opens_the_exercises_page', async () => {
    window.localStorage.setItem(`gt7.getReady.voiceLater.${USER.id}`, '1');
    getReadyApi(null);
    renderApp();
    await connectConsole();
    const link = await within(await findElWith('li.ready-step', /Pick your first/)).findByRole('link', { name: 'Choose an exercise' });
    expect(link).toHaveAttribute('href', '/exercises');
    await userEvent.setup().click(link);
    expect(await screen.findByRole('heading', { level: 2, name: 'Catalogue 0' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Get ready to train' })).toBeNull();
  });

  it('a_done_exercise_step_still_opens_the_exercises_page', async () => {
    window.localStorage.setItem(`gt7.getReady.voiceLater.${USER.id}`, '1');
    getReadyApi(null, [exercise()]);
    renderApp();
    await connectConsole();
    const link = within(step(/Pick your first/)).getByRole('link', { name: 'Open the exercises' });
    expect(link).toHaveAttribute('href', '/exercises');
    await userEvent.setup().click(link);
    expect(await screen.findByRole('heading', { level: 2, name: /^Catalogue/ })).toBeInTheDocument();
  });

  it('exercise_step_done_when_exercises_exist', async () => {
    getReadyApi(null, [exercise()]);
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'Get ready to train' })).toBeInTheDocument();
    expect(step(/Pick your first/)).toHaveTextContent('Done');
    expect(screen.getByText('1 of 3 ready')).toBeInTheDocument();
  });
});
