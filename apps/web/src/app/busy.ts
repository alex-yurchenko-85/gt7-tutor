import { ApiError } from '../api/client.ts';
import { errorText } from './resource.ts';
import { t } from './i18n.ts';

export function deletionErrorText(error: unknown): string {
  return error instanceof ApiError && error.code === 'busy' ? t('app.busy.delete') : errorText(error);
}
