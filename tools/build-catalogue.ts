import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { diffCatalogue, fetchCatalogue, slug, validateCatalogue } from '@gt7/catalogue';
import { ENGLISH, translate, type Catalogue } from '@gt7/contracts';

const catalogueDir = resolve('content/catalogue');
const cataloguePath = join(catalogueDir, 'catalogue.json');
const aliasesPath = join(catalogueDir, 'aliases.json');

function readAliases(): Record<string, number> {
  return existsSync(aliasesPath) ? (JSON.parse(readFileSync(aliasesPath, 'utf8')) as Record<string, number>) : {};
}

function readCommitted(): Catalogue | null {
  return existsSync(cataloguePath) ? validateCatalogue(JSON.parse(readFileSync(cataloguePath, 'utf8'))) : null;
}

function recordingFetch(directory: string): { fetch: typeof fetch; finish(): void } {
  mkdirSync(directory, { recursive: true });
  const index: Record<string, string> = {};
  const recorded: typeof fetch = async (input, init) => {
    const url = String(input);
    const response = await fetch(input, init);
    const body = await response.text();
    const file = `${slug(new URL(url).searchParams.get('page') ?? new URL(url).pathname.split('/').pop() ?? url)}.txt`;
    writeFileSync(join(directory, file), body);
    index[url] = file;
    return new Response(body, { status: response.status, headers: response.headers });
  };
  return { fetch: recorded, finish: () => writeFileSync(join(directory, 'index.json'), `${JSON.stringify(index, null, 2)}\n`) };
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { record: { type: 'string' }, 'timeout-ms': { type: 'string', default: '60000' } } });
  const recorder = values.record ? recordingFetch(resolve(values.record)) : null;
  const next = await fetchCatalogue({
    fetch: recorder?.fetch ?? fetch,
    aliases: readAliases(),
    timeoutMs: Number(values['timeout-ms'])
  });
  recorder?.finish();

  const committed = readCommitted();
  console.log(`Circuits: ${next.circuits.length}. Cars: ${next.cars.length}.`);
  console.log('Entries by family:', countBy(next.entries, entry => entry.family));
  const withoutTargets = next.entries.filter(entry => entry.family === 'Licence' && entry.targets === null).map(entry => entry.code);
  console.log('Licence tests without three target times:', withoutTargets);
  const unmatched = [...new Set(next.entries.filter(entry => entry.track && entry.circuitId === null).map(entry => entry.track))];
  console.log(`Track names without a circuit (add them to ${aliasesPath}):`, unmatched);

  if (committed) {
    const diff = diffCatalogue(committed, next);
    console.log(`Added: ${diff.added.length}`, diff.added.map(entry => entry.id));
    console.log(`Removed: ${diff.removed.length}`, diff.removed.map(entry => entry.id));
    console.log(`Changed: ${diff.changed.length}`, diff.changed.map(change => `${change.id} (${change.fields.join(', ')})`));
    if (diff.rejected) console.log(`Warning, the application would reject this update: ${translate(ENGLISH, 'errors.rejected', diff.rejected)}`);
  } else console.log('No committed catalogue. All entries are new.');

  mkdirSync(catalogueDir, { recursive: true });
  writeFileSync(cataloguePath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Wrote ${cataloguePath}. Review the differences before a commit.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
