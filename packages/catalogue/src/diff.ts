import type { Catalogue, CatalogueDiff, CatalogueEntry, CatalogueRejection } from '@gt7/contracts';

export const MAX_FAMILY_LOSS = 0.2;

function changedFields(before: CatalogueEntry, after: CatalogueEntry): string[] {
  const keys = Object.keys(after) as (keyof CatalogueEntry)[];
  return keys.filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

function familyCounts(entries: CatalogueEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.family, (counts.get(entry.family) ?? 0) + 1);
  return counts;
}

export function rejectionOf(current: Catalogue, next: Catalogue): CatalogueRejection | null {
  const nextCounts = familyCounts(next.entries);
  for (const [family, count] of familyCounts(current.entries)) {
    const lost = count - (nextCounts.get(family) ?? 0);
    if (lost / count > MAX_FAMILY_LOSS) {
      return { lost, total: count, family };
    }
  }
  return null;
}

export function diffCatalogue(current: Catalogue, next: Catalogue): CatalogueDiff {
  const currentById = new Map(current.entries.map(entry => [entry.id, entry]));
  const nextIds = new Set(next.entries.map(entry => entry.id));
  const changed: CatalogueDiff['changed'] = [];
  const added: CatalogueEntry[] = [];
  for (const entry of next.entries) {
    const before = currentById.get(entry.id);
    if (!before) added.push(entry);
    else {
      const fields = changedFields(before, entry);
      if (fields.length > 0) changed.push({ id: entry.id, fields });
    }
  }
  const removed = current.entries.filter(entry => !nextIds.has(entry.id));
  return { added, removed, changed, rejected: rejectionOf(current, next) };
}
