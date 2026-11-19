export function dropOldest(map: Map<unknown, unknown>, limit: number): void {
  while (map.size > limit) map.delete(map.keys().next().value);
}
