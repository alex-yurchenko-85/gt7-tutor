import type { CornerInfo, ReferenceCue, ReferenceTrace } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { useResource } from '../../app/resource.ts';
import { spokenCues } from './cue-display.ts';

export type ReferenceData = { trace: ReferenceTrace; corners: CornerInfo[]; cues: ReferenceCue[]; spoken: ReferenceCue[] };

export function useReferenceData(referenceId: string | null) {
  return useResource<ReferenceData | null>(
    () =>
      referenceId
        ? Promise.all([api.referenceTrace(referenceId), api.referenceCorners(referenceId), api.referenceCues(referenceId)]).then(([trace, corners, cues]) => ({
            trace,
            corners,
            cues,
            spoken: spokenCues(cues)
          }))
        : Promise.resolve(null),
    [referenceId]
  );
}
