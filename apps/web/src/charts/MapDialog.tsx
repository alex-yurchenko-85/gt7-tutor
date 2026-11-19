import { useEffect, useId, useRef, useState } from 'react';
import type { CornerInfo, ReferenceCue, ReferenceTrace } from '@gt7/contracts';
import { Icon } from '../app/icons.tsx';
import { useScrollLock } from '../app/scroll-lock.ts';
import { cornerMarks } from './corner-marks.ts';
import { TrackMap, type TrackMark } from './TrackMap.tsx';
import './map-dialog.css';

type MapDialogProps = {
  open: boolean;
  onClose(): void;
  title: string;
  trace: ReferenceTrace;
  cues: ReferenceCue[];
  corners: CornerInfo[];
};

function cueName(cue: ReferenceCue): string {
  return cue.phrase ?? cue.kind;
}

export function MapDialog({ open, onClose, title, trace, cues, corners }: MapDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const [showCues, setShowCues] = useState(true);
  const [showTurns, setShowTurns] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  useScrollLock(open);

  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!element.open) element.showModal();
    return () => {
      if (element.open) element.close();
      opener.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  const marks: TrackMark[] = [
    ...(showTurns ? cornerMarks(corners) : []),
    ...(showCues
      ? cues.map((cue, index) => ({
          sM: cue.sM,
          label: String(index + 1),
          title: `Cue ${index + 1}: ${cueName(cue)}`,
          muted: cue.muted,
          selected: selected === index,
          onSelect: () => setSelected(index)
        }))
      : [])
  ];

  return (
    <dialog
      ref={dialog}
      className="map-dialog"
      aria-labelledby={titleId}
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onClose();
      }}
    >
      <header className="map-dialog-bar">
        <button type="button" className="map-dialog-back" onClick={onClose}>
          <Icon name="chevron-right" size={16} />
          Back
        </button>
        <div className="map-dialog-title">
          <h2 id={titleId}>{title}</h2>
          <p>Reference line, {Math.round(trace.lengthM)} m. Press Esc to close.</p>
        </div>
        <div className="map-dialog-layers">
          <label>
            <input type="checkbox" checked={showCues} onChange={event => setShowCues(event.target.checked)} />
            Cues
          </label>
          <label>
            <input type="checkbox" checked={showTurns} onChange={event => setShowTurns(event.target.checked)} />
            Turns
          </label>
        </div>
      </header>
      <div className="map-dialog-body">
        <div className="map-dialog-map">
          <TrackMap label={`Reference line of ${title}`} reference={trace} marks={marks} dark />
        </div>
        <aside className="map-dialog-cues" aria-labelledby={`${titleId}-cues`}>
          <h3 id={`${titleId}-cues`}>Voice cues</h3>
          <p>Select a cue to find it on the line.</p>
          <ol>
            {cues.map((cue, index) => (
              <li key={cue.key}>
                <button type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}>
                  <span className="map-cue-number">{index + 1}</span>
                  <span>
                    <b>{cueName(cue)}</b>
                    <small>
                      {Math.round(cue.sM)} m{cue.muted ? ', muted' : ''}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </dialog>
  );
}
