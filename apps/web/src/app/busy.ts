import { ApiError } from '../api/client.ts';
import { errorText } from './resource.ts';

export const BUSY_TEXT = 'Stop the training or the recording first.';

export function deletionErrorText(error: unknown): string {
  return error instanceof ApiError && error.code === 'busy' ? BUSY_TEXT : errorText(error);
}
