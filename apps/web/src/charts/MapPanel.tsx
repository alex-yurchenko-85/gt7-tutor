import type { ReactNode } from 'react';
import { Icon } from '../app/icons.tsx';
import './charts.css';

export type LegendKey = 'reference' | 'you' | 'turn' | 'cue' | 'muted';

export type MapPanelProps = {
  title: string;
  legend: LegendKey[];
  far?: string | null;
  notes?: string[];
  actions?: ReactNode;
  onView(): void;
  children: ReactNode;
  below?: ReactNode;
};

const LEGEND: { key: LegendKey; mark: string; text: string }[] = [
  { key: 'reference', mark: 'ref', text: 'reference line' },
  { key: 'you', mark: 'you', text: 'you' },
  { key: 'turn', mark: 'turn', text: 'turn' },
  { key: 'cue', mark: 'cue', text: 'voice cue' },
  { key: 'muted', mark: 'cue muted', text: 'muted cue' }
];

export function MapPanel({ title, legend, far = null, notes = [], actions, onView, children, below }: MapPanelProps) {
  return (
    <section className="panel map-panel" aria-label={title}>
      <div className="map-panel-head">
        <h2>{title}</h2>
        {actions ? <div className="map-panel-actions">{actions}</div> : null}
        <button type="button" className="icon-button" aria-label="View the map in full screen" onClick={onView}>
          <Icon name="expand" size={16} />
          View
        </button>
      </div>
      {children}
      {below}
      <div className="legend map-legend">
        {LEGEND.filter(item => legend.includes(item.key)).map(item => (
          <span key={item.key}>
            <i className={item.mark} />
            {item.text}
          </span>
        ))}
        {far ? (
          <span>
            <i className="far" />
            {far}
          </span>
        ) : null}
        {notes.map(note => (
          <span key={note}>{note}</span>
        ))}
      </div>
    </section>
  );
}
