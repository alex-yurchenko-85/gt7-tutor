import { createReadStream, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

type ManifestRow = {
  name: string;
  file: string;
  source: string;
  range: { first: number; last: number };
  rows: number;
  startCueMonoMs: number | null;
  peerIp: '0.0.0.0';
  note: string;
};

type Manifest = { schemaVersion: 1; fixtures: ManifestRow[] };

const fixtureDir = resolve('fixtures');
const manifestPath = resolve(fixtureDir, 'manifest.json');
const scrubbedPeerIp = '0.0.0.0';

function readArguments() {
  const { values } = parseArgs({
    options: {
      in: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      name: { type: 'string' }
    }
  });
  const first = Number(values.from);
  const last = Number(values.to);
  if (!values.in || !values.name) throw new Error('Usage: make-fixture --in <path> --from <n> --to <n> --name <name>');
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first) {
    throw new Error('--from and --to must be integers with 0 <= from <= to');
  }
  if (!/^[a-z0-9-]+$/.test(values.name)) throw new Error('--name must use a-z, 0-9 and -');
  return { input: resolve(values.in), first, last, name: values.name };
}

function readStartCue(input: string): number | null {
  const summaryPath = `${input}.summary.json`;
  if (!existsSync(summaryPath)) return null;
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as { startCue?: { firedMonoMs?: number | null } | null };
  return summary.startCue?.firedMonoMs ?? null;
}

async function copyRange(input: string, first: number, last: number): Promise<string[]> {
  const rows: string[] = [];
  const lines = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === '') continue;
    const row = JSON.parse(line) as { rawIndex: number; peerIp: string };
    if (row.rawIndex < first || row.rawIndex > last) continue;
    rows.push(JSON.stringify({ ...row, peerIp: scrubbedPeerIp }));
  }
  if (rows.length !== last - first + 1) {
    throw new Error(`Expected ${last - first + 1} rows in range, found ${rows.length}`);
  }
  return rows;
}

function readManifest(): Manifest {
  if (!existsSync(manifestPath)) return { schemaVersion: 1, fixtures: [] };
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
}

function writeManifest(row: ManifestRow) {
  const manifest = readManifest();
  const fixtures = manifest.fixtures.filter(existing => existing.name !== row.name);
  fixtures.push(row);
  fixtures.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, fixtures }, null, 2) + '\n');
}

async function main() {
  const { input, first, last, name } = readArguments();
  const rows = await copyRange(input, first, last);
  mkdirSync(fixtureDir, { recursive: true });
  const file = `${name}.ndjson`;
  writeFileSync(resolve(fixtureDir, file), rows.join('\n') + '\n');
  writeManifest({
    name,
    file,
    source: basename(input, '.ndjson'),
    range: { first, last },
    rows: rows.length,
    startCueMonoMs: readStartCue(input),
    peerIp: scrubbedPeerIp,
    note: 'Raw GT7 telemetry recorded by the project author on their own PS5. Console address removed.'
  });
  console.log(`Wrote fixtures/${file} with ${rows.length} rows.`);
}

await main();
