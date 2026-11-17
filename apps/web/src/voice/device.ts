const DEVICE_KEY = 'gt7.voiceDeviceId';
const WANTS_VOICE_KEY = 'gt7.wantsVoice';
const CORRECTION_KEY = 'gt7.delayCorrectionMs';

export const MIN_CORRECTION_MS = -200;
export const MAX_CORRECTION_MS = 400;

type Scope = 'tab' | 'device';

function storage(scope: Scope): Storage {
  return scope === 'tab' ? window.sessionStorage : window.localStorage;
}

function read(scope: Scope, key: string): string | null {
  try {
    return storage(scope).getItem(key);
  } catch {
    return null;
  }
}

function write(scope: Scope, key: string, value: string | null): void {
  try {
    if (value === null) storage(scope).removeItem(key);
    else storage(scope).setItem(key, value);
  } catch {
    return;
  }
}

let fallbackDeviceId: string | null = null;

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function voiceDeviceId(): string {
  const stored = read('tab', DEVICE_KEY);
  if (stored) return stored;
  const created = `device-${randomId()}`;
  write('tab', DEVICE_KEY, created);
  if (read('tab', DEVICE_KEY) === created) return created;
  fallbackDeviceId ??= created;
  return fallbackDeviceId;
}

export function wantsVoice(): boolean {
  return read('tab', WANTS_VOICE_KEY) === 'yes';
}

export function setWantsVoice(wanted: boolean): void {
  write('tab', WANTS_VOICE_KEY, wanted ? 'yes' : null);
}

export function clampCorrection(ms: number): number {
  return Math.min(MAX_CORRECTION_MS, Math.max(MIN_CORRECTION_MS, Math.round(ms)));
}

export function delayCorrectionMs(): number {
  const value = Number(read('device', CORRECTION_KEY));
  return Number.isFinite(value) ? clampCorrection(value) : 0;
}

export function setDelayCorrectionMs(ms: number): void {
  write('device', CORRECTION_KEY, String(clampCorrection(ms)));
}
