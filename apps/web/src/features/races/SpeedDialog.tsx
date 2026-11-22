import { useLayoutEffect, useRef, useState } from 'react';
import type { RaceDetail, RaceLapsSpeed } from '@gt7/contracts';
import { Icon } from '../../app/icons.tsx';
import { useWideLayout } from '../../app/layout.ts';
import { useModalDialog } from '../../charts/use-modal-dialog.ts';
import { raceName } from './RacesView.tsx';
import { SPEED_HEIGHT, SpeedChart, type LapSelection } from './SpeedChart.tsx';
import '../../charts/map-dialog.css';
import { t } from '../../app/i18n.ts';

const MIN_HEIGHT = 160;
const FIELD_CHROME_PX = 72;

type SpeedDialogProps = { open: boolean; onClose(): void; race: RaceDetail; speed: RaceLapsSpeed; bestLap: number; selection: LapSelection };

function useFreeHeight(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(SPEED_HEIGHT);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!open || !element) return;
    const legend = () => element.querySelector<HTMLElement>('.lap-legend');
    const measure = () => {
      if (element.clientHeight > 0) setHeight(Math.max(MIN_HEIGHT, element.clientHeight - (legend()?.offsetHeight ?? 0) - FIELD_CHROME_PX));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const legendElement = legend();
    if (legendElement) observer.observe(legendElement);
    return () => observer.disconnect();
  }, [open]);
  return [ref, height] as const;
}

export function SpeedDialog({ open, onClose, race, speed, bestLap, selection }: SpeedDialogProps) {
  const wide = useWideLayout();
  const back = useRef<HTMLButtonElement>(null);
  const [chartRef, height] = useFreeHeight(open);
  const dialog = useModalDialog(open, onClose, back);

  if (!open) return null;

  const line = t('races.speed.full-line', { race: raceName(race), count: speed.laps.length });
  return (
    <dialog {...dialog} className="map-dialog speed-dialog night-chart">
      <header className="map-dialog-bar">
        <button ref={back} type="button" className="map-dialog-back" onClick={onClose}>
          <Icon name="chevron-right" size={16} />
          {t('charts.map.back')}
        </button>
        <div className="map-dialog-title">
          <h2>{t('races.speed.title')}</h2>
          <p>{wide ? `${line} ${t('charts.map.close-hint')}` : line}</p>
        </div>
      </header>
      <div className="speed-dialog-body">
        <div ref={chartRef} className="speed-dialog-chart">
          <SpeedChart id="race-speed-full" speed={speed} bestLap={bestLap} selection={selection} height={height} />
        </div>
      </div>
    </dialog>
  );
}
