const CATALOGUE_CHECK_KEY = 'gt7.catalogueCheck';

export type CatalogueCheck = { at: string; result: string };

function isCatalogueCheck(value: unknown): value is CatalogueCheck {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as CatalogueCheck).at === 'string' &&
    typeof (value as CatalogueCheck).result === 'string'
  );
}

export function lastCatalogueCheck(): CatalogueCheck | null {
  try {
    const stored = window.localStorage.getItem(CATALOGUE_CHECK_KEY);
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    return isCatalogueCheck(parsed) ? { at: parsed.at, result: parsed.result } : null;
  } catch {
    return null;
  }
}

export function rememberCatalogueCheck(check: CatalogueCheck): void {
  try {
    window.localStorage.setItem(CATALOGUE_CHECK_KEY, JSON.stringify({ at: check.at, result: check.result }));
  } catch {
    return;
  }
}
