import { t } from '../../app/i18n.ts';
export function TurnTag({ turn }: { turn: number | null }) {
  if (turn === null) return null;
  return (
    <>
      <span className="tag y turn-tag">{t('charts.turn.badge', { turn })}</span>{' '}
    </>
  );
}
