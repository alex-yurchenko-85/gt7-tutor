import { useState } from 'react';
import type { CornerInfo, ReferenceCue, ReferenceTrace } from '@gt7/contracts';
import { cornerMarks } from '../../charts/corner-marks.ts';
import { MapDialog, cueItems } from '../../charts/MapDialog.tsx';
import { MapPanel } from '../../charts/MapPanel.tsx';
import { TrackMap } from '../../charts/TrackMap.tsx';

type ReferenceMapProps = { title: string; reference: { trace: ReferenceTrace; cues: ReferenceCue[]; corners: CornerInfo[] } };

export function ReferenceMap({ title, reference }: ReferenceMapProps) {
  const [open, setOpen] = useState(false);
  const { trace, cues, corners } = reference;
  return (
    <MapPanel title={`Reference line, ${Math.round(trace.lengthM)} m`} legend={['reference', 'turn', 'cue', 'muted']} onView={() => setOpen(true)}>
      <TrackMap
        label="Reference line with the voice cues and the turns"
        reference={trace}
        marks={[
          ...cornerMarks(corners),
          ...cues.map((cue, index) => ({ sM: cue.sM, label: String(index + 1), muted: cue.muted, title: `Cue ${index + 1}: ${cue.phrase ?? cue.kind}` }))
        ]}
      />
      <MapDialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        lengthM={trace.lengthM}
        reference={trace}
        corners={corners}
        items={cueItems(cues)}
        listTitle="Voice cues"
        listHint="Select a cue to find it on the line."
      />
    </MapPanel>
  );
}
