import type { LiveState } from '@gt7/contracts';

export type Status = { tone: 'on' | 'warn' | 'off' | 'idle'; text: string };

export function telemetryStatus(state: LiveState | null, connected: boolean, demo = false): Status {
  if (!connected || !state) return { tone: 'off', text: 'Server not reachable' };
  if (state.mode === 'idle') return { tone: 'idle', text: 'Not receiving, no training running' };
  if (state.connection === 'connected') return { tone: 'on', text: 'Receiving telemetry' };
  if (state.connection === 'stale') return { tone: 'warn', text: demo ? 'Waiting for recorded data' : 'Waiting for packets' };
  return { tone: 'off', text: demo ? 'Recorded attempt ended' : 'No packets. Check the console address' };
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
  none: { tone: 'off', text: 'Voice not ready' },
  elsewhere: { tone: 'idle', text: 'Voice on another device' },
  here: { tone: 'on', text: 'Voice on this device' },
  'here-not-ready': { tone: 'warn', text: 'Voice not ready on this device' }
};

export function voiceStatus(state: LiveState | null, deviceId: string): Status {
  return VOICE_STATUS[voiceState(state, deviceId)];
}
