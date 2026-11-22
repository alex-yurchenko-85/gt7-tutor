export const BOX_GAP_PX = 12;
export const BOX_EDGE_PX = 8;

export type BoxSide = 'left' | 'right';

export function boxLeft(cursorPx: number, side: BoxSide, plotWidth: number, boxWidth: number): number {
  const wanted = side === 'right' ? cursorPx + BOX_GAP_PX : cursorPx - BOX_GAP_PX - boxWidth;
  return Math.max(BOX_EDGE_PX, Math.min(plotWidth - BOX_EDGE_PX - boxWidth, wanted));
}

export function boxColumns(columns: number, columnWidth: number, room: number): number {
  return Math.max(1, Math.min(columns, Math.floor(room / columnWidth)));
}
