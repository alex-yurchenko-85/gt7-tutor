import type { LiveState } from '@gt7/contracts';
import { t } from './i18n.ts';

export type Status = { tone: 'on' | 'warn' | 'off' | 'idle'; text: string };

export function telemetryStatus(state: LiveState | null, connected: boolean, demo = false): Status {
  if (!connected || !state) return { tone: 'off', text: t('app.status.no-answer') };
  if (state.mode === 'idle') return { tone: 'idle', text: t('app.status.idle') };
  if (state.connection === 'connected') return { tone: 'on', text: t('app.status.receiving') };
  if (state.connection === 'stale') return { tone: 'warn', text: demo ? t('app.status.waiting-recorded') : t('app.status.waiting') };
  return { tone: 'off', text: demo ? t('app.status.recorded-ended') : t('app.status.no-packets') };
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

const VOICE_TONE: Record<VoiceState, Status['tone']> = { none: 'off', elsewhere: 'on', here: 'on', 'here-not-ready': 'warn' };

export function voiceStatus(state: LiveState | null, deviceId: string): Status {
  const where = voiceState(state, deviceId);
  return { tone: VOICE_TONE[where], text: t(`app.voice.${where}`) };
}

export function statusLabel(name: string, status: Status): string {
  const sentence = status.text.endsWith('.') ? status.text : `${status.text}.`;
  return t('app.status.label', { name, status: sentence });
}
