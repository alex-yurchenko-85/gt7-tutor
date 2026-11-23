let pending: Promise<unknown> = Promise.resolve();

export function trackTargetSave<T>(save: Promise<T>): Promise<T> {
  pending = save.catch(() => undefined);
  return save;
}

export function afterTargetSave(): Promise<unknown> {
  return pending;
}
