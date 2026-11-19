import type { LiveState } from '@gt7/contracts';
import type { SetupSection } from '../../app/router.tsx';
import { consoleState, voiceState, type ConsoleState, type Status, type VoiceState } from '../../app/status.ts';

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
