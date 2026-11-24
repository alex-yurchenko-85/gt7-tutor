import { t } from './i18n.ts';
import { useWideLayout } from './layout.ts';

type SelectionBarProps = { count: number; action: string; onCancel(): void; onAction(): void };

export function SelectionBar({ count, action, onCancel, onAction }: SelectionBarProps) {
  const wide = useWideLayout();
  return (
    <div className="selection-bar">
      <b className="selection-count">{t('app.selection.count', { count })}</b>
      <button type="button" className="btn inline selection-cancel" onClick={onCancel}>
        {t('common.cancel')}
      </button>
      <button type="button" className="btn inline danger" onClick={onAction} disabled={count === 0}>
        {wide ? action : t('app.selection.delete')}
      </button>
    </div>
  );
}
