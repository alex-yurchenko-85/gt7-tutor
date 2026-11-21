import type { ReactNode } from 'react';
import type { MessageKey } from '@gt7/contracts';
import { Icon } from '../app/icons.tsx';
import './charts.css';
import { t } from '../app/i18n.ts';

export type LegendKey = 'reference' | 'you' | 'turn' | 'cue' | 'muted' | 'not-spoken';

export type MapPanelProps = {
  title: string;
  hideTitle?: boolean;
  legend: LegendKey[];
  far?: string | null;
  notes?: string[];
  actions?: ReactNode;
  onView(): void;
  children: ReactNode;
  below?: ReactNode;
  viewIcon?: boolean;
  legendTexts?: Partial<Record<LegendKey, string>>;
  extraLegend?: { mark: string; text: string }[];
};

const LEGEND: { key: LegendKey; mark: string; text: MessageKey }[] = [
  { key: 'reference', mark: 'ref', text: 'charts.legend.reference' },
  { key: 'you', mark: 'you', text: 'charts.legend.you' },
  { key: 'turn', mark: 'turn', text: 'charts.legend.turn' },
  { key: 'cue', mark: 'cue', text: 'charts.legend.cue' },
  { key: 'muted', mark: 'cue muted', text: 'charts.legend.muted' },
  { key: 'not-spoken', mark: 'cue not-spoken', text: 'charts.legend.not-spoken' }
];

export function MapPanel({ title, hideTitle = false, legend, far = null, notes = [], actions, onView, children, below, viewIcon = false, legendTexts = {}, extraLegend = [] }: MapPanelProps) {
  return (
    <section className="panel map-panel" aria-label={title}>
      <div className={hideTitle ? 'map-panel-head no-title' : 'map-panel-head'}>
        {hideTitle ? null : <h2>{title}</h2>}
        {actions ? <div className="map-panel-actions">{actions}</div> : null}
        <button type="button" className={`icon-button${viewIcon ? ' icon-only' : ''}`} aria-label={t('charts.map.view-label')} onClick={onView}>
          <Icon name="expand" size={16} />
          {viewIcon ? null : t('charts.map.view')}
        </button>
      </div>
      {children}
      {below}
      <div className="legend map-legend">
        {LEGEND.filter(item => legend.includes(item.key)).map(item => (
          <span key={item.key}>
            <i className={item.mark} />
            {legendTexts[item.key] ?? t(item.text)}
          </span>
        ))}
        {extraLegend.map(item => (
          <span key={item.text}>
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
