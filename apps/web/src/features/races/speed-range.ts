export function speedRange(lines: (number | null)[][]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const line of lines) {
    for (const value of line) {
      if (value === null) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  return min === Infinity ? null : { min, max };
}
