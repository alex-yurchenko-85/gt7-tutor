import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

type ImportedRace = {
  raceId: string;
  trackName: string | null;
  candidates: string[];
  laps: { number: number; timeMs: number }[];
  bestLap: number;
  bestLapMs: number;
  laterRace: boolean;
};

type RaceImportModule = { importRaceFile: (env: Record<string, unknown>, userName: string, sourcePath: string) => Promise<ImportedRace> };

const usage = 'Usage: pnpm race:import --file <raw capture .ndjson> --profile <profile name>';
const serverImport = new URL('../apps/server/dist/races/race-import.app.js', import.meta.url);

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(3)} s`;
}

function trackLine(race: ImportedRace): string {
  if (race.trackName !== null) return `Track: ${race.trackName}`;
  if (race.candidates.length > 0) return `Track candidates: ${race.candidates.join(', ')}`;
  return 'Track: not known';
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { file: { type: 'string' }, profile: { type: 'string' }, help: { type: 'boolean', default: false } } });
  if (values.help) {
    console.log(usage);
    return;
  }
  if (!values.file || !values.profile) throw new Error(usage);
  const file = resolve(process.env.INIT_CWD ?? process.cwd(), values.file);
  if (existsSync('.env')) process.loadEnvFile('.env');
  if (!existsSync(serverImport)) throw new Error('The server is not built. Run pnpm --filter @gt7/server... run build.');
  const { importRaceFile } = (await import(serverImport.href)) as RaceImportModule;
  const race = await importRaceFile(process.env, values.profile, file);
  console.log(`Race ${race.raceId}`);
  console.log(trackLine(race));
  console.log(`Laps: ${race.laps.map(lap => `${lap.number} ${seconds(lap.timeMs)}`).join(', ')}`);
  console.log(`Best lap: ${race.bestLap}, ${seconds(race.bestLapMs)}`);
  if (race.laterRace) console.log('The file holds one more race or more. Only the first race is stored.');
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
