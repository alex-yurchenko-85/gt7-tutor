import type { CornerInfo } from '@gt7/contracts';
import type { TrackMark } from './TrackMap.tsx';

export function cornerMarks(corners: CornerInfo[]): TrackMark[] {
  return corners.map(corner => ({ sM: corner.zoneFromSM, toSM: corner.zoneToSM, kind: 'turn' as const, label: `T${corner.number}`, title: `Turn ${corner.number}` }));
}
