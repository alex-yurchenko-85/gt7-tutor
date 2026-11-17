import type { CornerInfo } from '@gt7/contracts';
import type { TrackMark } from './TrackMap.tsx';

export function cornerMarks(corners: CornerInfo[]): TrackMark[] {
  return corners.flatMap((corner) => [
    { sM: corner.turnInSM, kind: 'turn-in' as const, title: `Turn-in of turn ${corner.number}` },
    { sM: corner.apexSM, kind: 'apex' as const, label: `T${corner.number}`, title: `Apex of turn ${corner.number}` },
  ]);
}
