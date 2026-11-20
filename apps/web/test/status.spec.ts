import { describe, expect, it } from 'vitest';
import { telemetryStatus, voiceStatus } from '../src/app/status.ts';
import { liveState } from './support.tsx';

const DEVICE = 'this-device';

describe('telemetry status', () => {
  it('server_not_answering_is_red', () => {
    expect(telemetryStatus(null, false)).toEqual({ tone: 'off', text: 'GT7 Tutor does not answer. Check that it runs on the computer.' });
    expect(telemetryStatus(liveState(), false)).toEqual({ tone: 'off', text: 'GT7 Tutor does not answer. Check that it runs on the computer.' });
  });

  it('idle_server_is_grey', () => {
    expect(telemetryStatus(liveState({ mode: 'idle' }), true)).toEqual({ tone: 'idle', text: 'No telemetry now. It starts with a recording, a training or a check.' });
  });

  it('receiving_is_green', () => {
    expect(telemetryStatus(liveState({ mode: 'armed', connection: 'connected' }), true)).toEqual({ tone: 'on', text: 'Receiving telemetry' });
  });

  it('waiting_is_yellow', () => {
    expect(telemetryStatus(liveState({ mode: 'armed', connection: 'stale' }), true)).toEqual({ tone: 'warn', text: 'Waiting for packets' });
  });

  it('demo_waiting_text_is_the_same_as_on_drive', () => {
    expect(telemetryStatus(liveState({ mode: 'armed', connection: 'stale' }), true, true)).toEqual({ tone: 'warn', text: 'Waiting for the recorded data.' });
  });

  it('no_packets_is_red', () => {
    expect(telemetryStatus(liveState({ mode: 'armed', connection: 'disconnected' }), true)).toEqual({ tone: 'off', text: 'No packets. Check the console address.' });
  });

  it('demo_no_packets_keeps_the_demo_text', () => {
    expect(telemetryStatus(liveState({ mode: 'armed', connection: 'disconnected' }), true, true)).toEqual({ tone: 'off', text: 'Recorded attempt ended' });
  });
});

describe('voice status', () => {
  it('this_device_is_green', () => {
    expect(voiceStatus(liveState({ voiceDeviceId: DEVICE, voiceReady: true }), DEVICE)).toEqual({ tone: 'on', text: 'This device plays the voice' });
  });

  it('another_device_is_green', () => {
    expect(voiceStatus(liveState({ voiceDeviceId: 'other-device', voiceReady: true }), DEVICE)).toEqual({ tone: 'on', text: 'Another device plays the voice' });
  });

  it('no_device_is_red', () => {
    expect(voiceStatus(liveState({ voiceDeviceId: null }), DEVICE)).toEqual({ tone: 'off', text: 'No device plays the voice' });
    expect(voiceStatus(null, DEVICE)).toEqual({ tone: 'off', text: 'No device plays the voice' });
  });

  it('sound_not_started_is_yellow', () => {
    expect(voiceStatus(liveState({ voiceDeviceId: DEVICE, voiceReady: false }), DEVICE)).toEqual({ tone: 'warn', text: 'The sound did not start on this device' });
  });
});
