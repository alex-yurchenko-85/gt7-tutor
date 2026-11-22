import { useEffect, useId, useRef, useState } from 'react';
import type { CornerInfo, ReferenceCue } from '@gt7/contracts';
import { metres } from '../app/format.ts';
import { Icon } from '../app/icons.tsx';
import { useWideLayout } from '../app/layout.ts';
import { useScrollLock } from '../app/scroll-lock.ts';
import { cornerMarks } from './corner-marks.ts';
import { TrackMap, type TrackLine, type TrackMark } from './TrackMap.tsx';
import './map-dialog.css';
import { cuePhrase, t } from '../app/i18n.ts';

export type MapDialogItem = { key: string; number: string; label: string; detail: string; sM: number; muted?: boolean; onAttempt?: boolean };

export type MapDialogProps = {
  open: boolean;
  onClose(): void;
  title: string;
  lengthM: number;
  reference: TrackLine;
  attempt?: TrackLine | null;
  corners: CornerInfo[];
  items: MapDialogItem[];
  listTitle: string;
  mapLabel?: string;
  lineName?: string;
  lapLine?: boolean;
  metresText?: (value: number) => string;
};

export function cueItems(cues: ReferenceCue[], isMuted: (cue: ReferenceCue) => boolean = cue => cue.muted): MapDialogItem[] {
  return cues.map((cue, index) => {
    const muted = isMuted(cue);
    return { key: cue.key, number: String(index + 1), label: cuePhrase(cue) ?? cue.kind, detail: t(muted ? 'charts.map.cue-detail-muted' : 'charts.map.cue-detail', { metres: Math.round(cue.sM) }), sM: cue.sM, muted };
  });
}

function itemMark(item: MapDialogItem, selected: boolean, onSelect: () => void): TrackMark {
  return {
    sM: item.sM,
    ...(item.onAttempt ? { onAttempt: true } : { label: item.number }),
    title: `${[item.number, item.label].filter(Boolean).join(': ')}, ${item.detail}`,
    muted: item.muted ?? false,
    selected,
    onSelect
  };
}

export function MapDialog({ open, onClose, title, lengthM, reference, attempt = null, corners, items, listTitle, mapLabel, lineName, lapLine = false, metresText = metres }: MapDialogProps) {
  const wide = useWideLayout();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const [showItems, setShowItems] = useState(true);
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
    ...(showItems ? items.map((item, index) => itemMark(item, selected === index, () => setSelected(index))) : [])
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
          {t('charts.map.back')}
        </button>
        <div className="map-dialog-title">
          <h2 id={titleId}>{title}</h2>
          <p>{`${t('charts.map.line-length', { line: lineName ?? t('charts.map.line-name'), length: metresText(lengthM) })}${wide ? ` ${t('charts.map.close-hint')}` : ''}`}</p>
        </div>
        <div className="map-dialog-layers">
          <label>
            <input type="checkbox" checked={showItems} onChange={event => setShowItems(event.target.checked)} />
            {listTitle}
          </label>
          <label>
            <input type="checkbox" checked={showTurns} onChange={event => setShowTurns(event.target.checked)} />
            {t('charts.map.turns')}
          </label>
        </div>
      </header>
      <div className="map-dialog-body">
        <div className="map-dialog-map">
          <TrackMap label={mapLabel ?? (attempt ? t('charts.map.reference-and-yours', { title }) : t('charts.map.reference-of', { title }))} reference={reference} attempt={attempt} marks={marks} lapLine={lapLine} dark />
        </div>
        <aside className="map-dialog-cues" aria-labelledby={`${titleId}-cues`}>
          <h3 id={`${titleId}-cues`}>{listTitle}</h3>
          <ol>
            {items.map((item, index) => (
              <li key={item.key}>
                <button type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}>
                  <span className="map-cue-number">{item.number}</span>
                  <span>
                    <b>{item.label}</b>
                    <small>{item.detail}</small>
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
