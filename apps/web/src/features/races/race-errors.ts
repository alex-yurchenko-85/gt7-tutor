import { ApiError } from '../../api/client.ts';
import { t } from '../../app/i18n.ts';

export function rawMissingText(): string {
  return t('races.raw-missing');
}

export function isRawMissing(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'raw-missing';
}
