import type { ChartBand } from './ChannelChart.tsx';

export type TurnLabelPlace = { label: string; centre: number; row: 0 | 1 };

export const LABEL_CHAR_PX = 8;
export const LABEL_GAP_PX = 2;
export const LABEL_HEIGHT_PX = 12;
export const LABEL_TOP_PX = 4;
export const LABEL_ROW_STEP_PX = LABEL_HEIGHT_PX + LABEL_GAP_PX;

export function turnLabelPlaces(bands: ChartBand[], lengthM: number, plotWidth: number, dropCrowded = false): TurnLabelPlace[] {
  const rights = [-Infinity, -Infinity];
  return [...bands]
    .sort((a, b) => a.fromSM + a.toSM - (b.fromSM + b.toSM))
    .flatMap(band => {
      const width = band.label.length * LABEL_CHAR_PX;
      const wanted = ((band.fromSM + band.toSM) / 2 / lengthM) * plotWidth;
      const centre = Math.max(width / 2, Math.min(plotWidth - width / 2, wanted));
      const left = centre - width / 2;
      const fits = (row: 0 | 1) => left >= rights[row]! + LABEL_GAP_PX;
      if (dropCrowded && !fits(0) && !fits(1)) return [];
      const row = fits(0) ? 0 : 1;
      rights[row] = centre + width / 2;
      return [{ label: band.label, centre, row }];
    });
}
