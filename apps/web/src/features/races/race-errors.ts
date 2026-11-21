import { ApiError } from '../../api/client.ts';

export const RAW_MISSING_TEXT = 'The recording of this race is no longer on the disk. The lap table stays.';

export function isRawMissing(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'raw-missing';
}
