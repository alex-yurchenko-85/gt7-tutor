import { readStored, writeStored } from '../app/storage.ts';

const DEVICE_KEY = 'gt7.voiceDeviceId';
const WANTS_VOICE_KEY = 'gt7.wantsVoice';
const CORRECTION_KEY = 'gt7.delayCorrectionMs';

export const MIN_CORRECTION_MS = -200;
export const MAX_CORRECTION_MS = 400;

let fallbackDeviceId: string | null = null;

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function voiceDeviceId(): string {
  const stored = readStored(DEVICE_KEY, 'tab');
  if (stored) return stored;
  const created = `device-${randomId()}`;
  writeStored(DEVICE_KEY, created, 'tab');
  if (readStored(DEVICE_KEY, 'tab') === created) return created;
  fallbackDeviceId ??= created;
  return fallbackDeviceId;
}

export function wantsVoice(): boolean {
  return readStored(WANTS_VOICE_KEY, 'tab') === 'yes';
}

export function setWantsVoice(wanted: boolean): void {
  writeStored(WANTS_VOICE_KEY, wanted ? 'yes' : null, 'tab');
}

export function clampCorrection(ms: number): number {
  return Math.min(MAX_CORRECTION_MS, Math.max(MIN_CORRECTION_MS, Math.round(ms)));
}

export function delayCorrectionMs(): number {
  const value = Number(readStored(CORRECTION_KEY));
  return Number.isFinite(value) ? clampCorrection(value) : 0;
}

export function setDelayCorrectionMs(ms: number): void {
  writeStored(CORRECTION_KEY, String(clampCorrection(ms)));
}
