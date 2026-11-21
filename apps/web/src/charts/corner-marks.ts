import type { CornerInfo } from '@gt7/contracts';
import type { TrackMark } from './TrackMap.tsx';
import { t } from '../app/i18n.ts';

export function cornerMarks(corners: CornerInfo[]): TrackMark[] {
  return corners.map(corner => ({ sM: corner.zoneFromSM, toSM: corner.zoneToSM, kind: 'turn' as const, label: t('charts.turn.badge', { turn: corner.number }), title: t('charts.turn.title', { turn: corner.number }) }));
}
