import type { FocusSummary } from '@gt7/contracts';
import { focusText, t } from '../../app/i18n.ts';
import './focus-line.css';

export function FocusLine({ focus }: { focus: FocusSummary }) {
  return (
    <div className="focus-line">
      <span>{t('exercises.focus.label')}</span>
      <b>{focusText(focus)}</b>
    </div>
  );
}
