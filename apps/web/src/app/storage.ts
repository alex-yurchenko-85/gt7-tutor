export type StorageScope = 'tab' | 'device';

function area(scope: StorageScope): Storage {
  return scope === 'tab' ? window.sessionStorage : window.localStorage;
}

export function readStored(key: string, scope: StorageScope = 'device'): string | null {
  try {
    return area(scope).getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string | null, scope: StorageScope = 'device'): void {
  try {
    if (value === null) area(scope).removeItem(key);
    else area(scope).setItem(key, value);
  } catch {
    return;
  }
}
