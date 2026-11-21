const STEP_FACTORS = [1, 2, 5, 10];
const DISTANCE_TICK_COUNT = 5;
const END_GAP_OF_STEP = 0.3;

function niceStep(span: number, count: number): number {
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const candidates = STEP_FACTORS.map(factor => factor * power);
  return candidates.reduce((best, candidate) => (Math.abs(candidate - raw) < Math.abs(best - raw) ? candidate : best));
}

function decimals(step: number): number {
  return Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
}

function rounded(value: number, step: number): number {
  return Number(value.toFixed(decimals(step)));
}

export function valueTicks(min: number, max: number, count: number): number[] {
  if (!(max > min)) return [];
  const step = niceStep(max - min, count);
  const ticks: number[] = [];
  for (let tick = Math.ceil(min / step) * step; tick <= max + step * 1e-9; tick += step) ticks.push(rounded(tick, step) + 0);
  return ticks;
}

export function distanceTicks(lengthM: number): number[] {
  if (!(lengthM > 0)) return [];
  const step = niceStep(lengthM, DISTANCE_TICK_COUNT);
  return valueTicks(0, lengthM, DISTANCE_TICK_COUNT).filter(tick => tick === 0 || lengthM - tick >= step * END_GAP_OF_STEP);
}

export function tickStep(ticks: number[]): number {
  return ticks.length > 1 ? ticks[1]! - ticks[0]! : 1;
}

export function signedTickLabel(value: number, step: number): string {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(decimals(step))}`;
}

export function tickLabel(value: number, step: number): string {
  return value.toFixed(decimals(step));
}

export function labelledTicks(min: number, max: number, count: number, label: (value: number, step: number) => string = tickLabel): { value: number; label: string }[] {
  const values = valueTicks(min, max, count);
  const step = tickStep(values);
  return values.map(value => ({ value, label: label(value, step) }));
}
