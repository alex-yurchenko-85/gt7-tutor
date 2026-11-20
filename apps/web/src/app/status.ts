import type { LiveState } from '@gt7/contracts';

export type Status = { tone: 'on' | 'warn' | 'off' | 'idle'; text: string };

export function telemetryStatus(state: LiveState | null, connected: boolean, demo = false): Status {
  if (!connected || !state) return { tone: 'off', text: 'GT7 Tutor does not answer. Check that it runs on the computer.' };
  if (state.mode === 'idle') return { tone: 'idle', text: 'No telemetry now. It starts with a recording, a training or a check.' };
  if (state.connection === 'connected') return { tone: 'on', text: 'Receiving telemetry' };
  if (state.connection === 'stale') return { tone: 'warn', text: demo ? 'Waiting for the recorded data.' : 'Waiting for packets' };
  return { tone: 'off', text: demo ? 'Recorded attempt ended' : 'No packets. Check the console address.' };
}

export type ConsoleState = 'recorded-data' | 'no-address' | 'receiving' | 'address-saved';

export type VoiceState = 'none' | 'elsewhere' | 'here' | 'here-not-ready';

export function consoleState(ps5Ip: string | null | undefined, state: LiveState | null, connected: boolean, recordedData: boolean): ConsoleState {
  if (recordedData) return 'recorded-data';
  if (ps5Ip === null) return 'no-address';
  if (connected && state?.connection === 'connected') return 'receiving';
  return 'address-saved';
}

export function voiceState(state: LiveState | null, deviceId: string): VoiceState {
  if (!state || state.voiceDeviceId === null) return 'none';
  if (state.voiceDeviceId !== deviceId) return 'elsewhere';
  return state.voiceReady ? 'here' : 'here-not-ready';
}

const VOICE_STATUS: Record<VoiceState, Status> = {
  none: { tone: 'off', text: 'No device plays the voice' },
  elsewhere: { tone: 'on', text: 'Another device plays the voice' },
  here: { tone: 'on', text: 'This device plays the voice' },
  'here-not-ready': { tone: 'warn', text: 'The sound did not start on this device' }
};

export function voiceStatus(state: LiveState | null, deviceId: string): Status {
  return VOICE_STATUS[voiceState(state, deviceId)];
}

export function statusLabel(name: string, status: Status): string {
  const sentence = status.text.endsWith('.') ? status.text : `${status.text}.`;
  return `${name}: ${sentence} Open Setup`;
}
