import { parseArgs } from 'node:util';
import { ReplaySource } from '@gt7/capture';
import { TelemetryStats } from './telemetry-stats.ts';

async function main() {
  const { values } = parseArgs({ options: { file: { type: 'string' } } });
  if (!values.file) throw new Error('Usage: pnpm replay --file <raw capture .ndjson>');
  const stats = new TelemetryStats();
  const source = new ReplaySource({ path: values.file, speed: 0 });
  await source.start(datagram => stats.add(datagram));
  await source.finished;
  console.log(JSON.stringify({ file: values.file, telemetry: stats.result() }, null, 2));
}

await main();
