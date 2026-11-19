import type { LiveState } from '@gt7/contracts';
import type { SetupSection } from '../../app/router.tsx';
import type { Status } from '../../app/status.ts';

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

const CONSOLE_READINESS: Record<ConsoleState, Status> = {
  'recorded-data': { tone: 'on', text: 'Console: recorded data' },
  'no-address': { tone: 'off', text: 'Console: no address' },
  receiving: { tone: 'on', text: 'Console connected' },
  'address-saved': { tone: 'idle', text: 'Console: address saved' }
};

const VOICE_READINESS: Record<VoiceState, Status> = {
  none: { tone: 'off', text: 'Voice: no device' },
  elsewhere: { tone: 'on', text: 'Voice: another device' },
  here: { tone: 'on', text: 'Voice: this device' },
  'here-not-ready': { tone: 'warn', text: 'Voice: not ready on this device' }
};

export function consoleReadiness(ps5Ip: string | null, state: LiveState | null, connected: boolean, demo: boolean): Status {
  return CONSOLE_READINESS[consoleState(ps5Ip, state, connected, demo)];
}

export function voiceReadiness(state: LiveState | null, deviceId: string): Status {
  return VOICE_READINESS[voiceState(state, deviceId)];
}

export function defaultSection(ps5Ip: string | null, demo: boolean, voiceDeviceId: string | null): SetupSection {
  if (ps5Ip === null && !demo) return 'console';
  if (voiceDeviceId === null) return 'voice';
  return 'profiles';
}
