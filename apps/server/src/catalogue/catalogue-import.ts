import type { Catalogue, CatalogueEntry, MedalTargetTimes } from '@gt7/contracts';
import type { Knex } from 'knex';

type StoredTargets = { id: string; targets: MedalTargetTimes | null };

function exerciseTargets(targets: MedalTargetTimes | null): string {
  return JSON.stringify(targets ?? {});
}

function targetsKey(targets: MedalTargetTimes | null): string {
  return targets === null ? 'none' : `${targets.bronzeMs}/${targets.silverMs}/${targets.goldMs}`;
}

function entryRow(entry: CatalogueEntry) {
  return {
    id: entry.id,
    family: entry.family,
    collection: entry.collection,
    code: entry.code,
    name: entry.name,
    track: entry.track,
    circuit_id: entry.circuitId === null ? null : String(entry.circuitId),
    car: entry.car,
    targets: entry.targets === null ? null : JSON.stringify(entry.targets),
    sections: entry.sections === null ? null : JSON.stringify(entry.sections),
    source: entry.source,
    support: entry.support
  };
}

async function followUneditedTargets(trx: Knex.Transaction, entries: CatalogueEntry[], stored: Map<string, MedalTargetTimes | null>) {
  for (const entry of entries) {
    if (!stored.has(entry.id)) continue;
    const before = stored.get(entry.id) ?? null;
    if (targetsKey(before) === targetsKey(entry.targets)) continue;
    await trx('exercises')
      .where({ catalogue_id: entry.id })
      .whereRaw('targets = ?::jsonb', [exerciseTargets(before)])
      .update({ targets: exerciseTargets(entry.targets) });
  }
}

export async function importCatalogue(db: Knex, catalogue: Catalogue): Promise<void> {
  await db.transaction(async trx => {
    const storedRows = await trx<StoredTargets>('catalogue_entries').select('id', 'targets');
    const stored = new Map(storedRows.map(row => [row.id, row.targets]));
    for (let start = 0; start < catalogue.entries.length; start += 200) {
      const rows = catalogue.entries.slice(start, start + 200).map(entryRow);
      await trx('catalogue_entries').insert(rows).onConflict('id').merge();
    }
    await followUneditedTargets(trx, catalogue.entries, stored);
    await trx('catalogue_entries')
      .whereNotIn('id', catalogue.entries.map(entry => entry.id))
      .whereNotExists(trx('exercises').select(trx.raw('1')).whereRaw('exercises.catalogue_id = catalogue_entries.id'))
      .delete();
  });
}
