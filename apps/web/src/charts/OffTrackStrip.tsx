import { useEffect, useMemo, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { KPH_PER_MPS, type RaceOffTrack, type RaceOffTrackView, type RaceRecurringPlace } from '@gt7/contracts';
import './charts.css';
import { groupedMetres } from '../app/format.ts';
import { t } from '../app/i18n.ts';

type OffTrackStripProps = {
  lengthM: number;
  laps: number[];
  moments: RaceOffTrack[];
  recurring: RaceRecurringPlace[];
  pitLane: RaceOffTrackView['pitLane'];
  cursorSM: number;
  onCursor(sM: number): void;
  selected: number | null;
  onSelect(index: number | null): void;
  box?: ReactNode;
};

export function tenMetres(value: number): string {
  return groupedMetres(Math.round(value / 10) * 10);
}

export function wheelsText(moment: RaceOffTrack): string {
  return t(`charts.off-track.wheels-${moment.wheels}`, { seconds: (moment.durationMs / 1000).toFixed(1) });
}

export function speedsText(moment: RaceOffTrack, spoken = false): string {
  return t(spoken ? 'charts.off-track.speeds-spoken' : 'charts.off-track.speeds', { from: Math.round(moment.speedInMps * KPH_PER_MPS), to: Math.round(moment.speedMinMps * KPH_PER_MPS) });
}

export function momentLabel(moment: RaceOffTrack): string {
  const parts = { lap: moment.lap, wheels: wheelsText(moment), speeds: speedsText(moment, true) };
  return moment.sM === null ? t('charts.off-track.moment', parts) : t('charts.off-track.moment-at', { ...parts, place: tenMetres(moment.sM) });
}

function share(value: number, lengthM: number): string {
  return `${((Math.max(0, Math.min(lengthM, value)) / lengthM) * 100).toFixed(3)}%`;
}

export function placeParts(place: RaceRecurringPlace, lengthM: number): { fromSM: number; toSM: number }[] {
  if (place.fromSM <= place.toSM) return [{ fromSM: place.fromSM, toSM: place.toSM }];
  return [
    { fromSM: place.fromSM, toSM: lengthM },
    { fromSM: 0, toSM: place.toSM }
  ];
}

const NEAR_LETTER_SHARE = 0.05;

function letterSides(recurring: RaceRecurringPlace[], lengthM: number): Map<string, string> {
  const centres = recurring
    .map(place => {
      const band = placeParts(place, lengthM)[0]!;
      return { label: place.label, at: (band.fromSM + band.toSM) / 2 };
    })
    .sort((a, b) => a.at - b.at);
  const near = (a: { at: number } | undefined, b: { at: number } | undefined) => a !== undefined && b !== undefined && b.at - a.at < NEAR_LETTER_SHARE * lengthM;
  return new Map(centres.map((centre, index) => [centre.label, near(centres[index - 1], centre) ? 'after' : near(centre, centres[index + 1]) ? 'before' : '']));
}

export function OffTrackStrip({ lengthM, laps, moments, recurring, pitLane, cursorSM, onCursor, selected, onSelect, box = null }: OffTrackStripProps) {
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const keyed = useRef(false);
  const sides = useMemo(() => letterSides(recurring, lengthM), [recurring, lengthM]);
  useEffect(() => {
    if (selected === null || !keyed.current) return;
    keyed.current = false;
    buttons.current.get(selected)?.focus();
  }, [selected]);
  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    onCursor(Math.max(0, Math.min(lengthM, ((event.clientX - box.left) / box.width) * lengthM)));
  };
  const fromKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onSelect(null);
      return;
    }
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    keyed.current = true;
    onSelect(Math.max(0, Math.min(moments.length - 1, index + step)));
  };
  return (
    <div className="strip">
      <div className="strip-body">
        <div className="strip-laps" aria-hidden="true">
          {laps.map(lap => (
            <span key={lap}>{lap}</span>
          ))}
        </div>
        <div
          className="plot strip-plot"
          onPointerDown={fromPointer}
          onPointerMove={event => {
            if (event.buttons > 0 || event.pointerType === 'mouse') fromPointer(event);
          }}
        >
          {recurring.flatMap(place =>
            placeParts(place, lengthM).map((band, part) => (
              <div key={`${place.label}-${part}`} className="strip-place" data-place={place.label} style={{ left: share(band.fromSM, lengthM), width: share(band.toSM - band.fromSM, lengthM) }}>
                {part === 0 ? (
                  <b className={sides.get(place.label) || undefined} aria-hidden="true">
                    {place.label}
                  </b>
                ) : null}
              </div>
            ))
          )}
          {laps.map(lap => (
            <div key={lap} className="strip-row" role="group" aria-label={t('charts.off-track.row', { lap })} data-lap={lap}>
              <i className="strip-rule" aria-hidden="true" />
              {pitLane
                .filter(range => range.lap === lap)
                .map(range => (
                  <i key={`${range.fromSM}`} className="strip-pit" aria-hidden="true" style={{ left: share(range.fromSM, lengthM), width: share(range.toSM - range.fromSM, lengthM) }} />
                ))}
              {moments.map((moment, index) =>
                moment.lap === lap && moment.sM !== null ? (
                  <button
                    key={index}
                    ref={element => {
                      if (element) buttons.current.set(index, element);
                      else buttons.current.delete(index);
                    }}
                    type="button"
                    className={`strip-moment ${moment.wheels === 4 ? 'all' : 'part'}`}
                    style={{ left: share(moment.sM, lengthM) }}
                    aria-label={momentLabel(moment)}
                    aria-pressed={selected === index}
                    onClick={() => onSelect(index)}
                    onKeyDown={event => fromKey(event, index)}
                  >
                    <i aria-hidden="true" />
                  </button>
                ) : null
              )}
            </div>
          ))}
          <i className="strip-cursor" aria-hidden="true" style={{ left: share(cursorSM, lengthM) }} />
          {box}
        </div>
      </div>
    </div>
  );
}
