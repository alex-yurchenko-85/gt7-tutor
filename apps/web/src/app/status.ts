import type { LiveState } from '@gt7/contracts';

export type Status = { tone: 'on' | 'warn' | 'off' | 'idle'; text: string };

export function telemetryStatus(state: LiveState | null, connected: boolean, demo = false): Status {
  if (!connected || !state) return { tone: 'off', text: 'Server not reachable' };
  if (state.mode === 'idle') return { tone: 'idle', text: 'Not receiving, nothing armed' };
  if (state.connection === 'connected') return { tone: 'on', text: 'Receiving telemetry' };
  if (state.connection === 'stale') return { tone: 'warn', text: demo ? 'Waiting for recorded data' : 'Waiting for packets' };
  return { tone: 'off', text: demo ? 'Recorded attempt ended' : 'No packets. Check the console address' };
}

export function voiceStatus(state: LiveState | null, deviceId: string): Status {
  if (!state || state.voiceDeviceId === null) return { tone: 'off', text: 'Voice not ready' };
  if (state.voiceDeviceId !== deviceId) return { tone: 'idle', text: 'Voice on another device' };
  return state.voiceReady ? { tone: 'on', text: 'Voice on this device' } : { tone: 'warn', text: 'Voice not ready on this device' };
}
