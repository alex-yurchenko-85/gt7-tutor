import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { RawWriter, UdpSource, type Datagram } from '@gt7/capture';
import { TelemetryStats } from './telemetry-stats.ts';

type Purpose = 'demo' | 'player';

type CaptureArguments = { ip: string; seconds: number; purpose: Purpose };

const usage = 'Usage: pnpm capture --ip <PS5 IPv4> --purpose demo|player [--seconds 90]';

export function isIPv4(text: string): boolean {
  const parts = text.split('.');
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function readArguments(): CaptureArguments {
  const { values } = parseArgs({
    options: {
      ip: { type: 'string' },
      seconds: { type: 'string', default: '90' },
      purpose: { type: 'string' },
      help: { type: 'boolean', default: false }
    }
  });
  if (values.help) {
    console.log(usage);
    process.exit(0);
  }
  if (!values.ip || !isIPv4(values.ip)) throw new Error(`--ip must be an IPv4 address. ${usage}`);
  if (values.purpose !== 'demo' && values.purpose !== 'player') throw new Error(`--purpose must be demo or player. ${usage}`);
  const seconds = Number(values.seconds);
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600) throw new Error('--seconds must be from 1 to 3600');
  return { ip: values.ip, seconds, purpose: values.purpose };
}

function instruction(purpose: Purpose): string {
  return purpose === 'demo'
    ? 'Press Demonstration on PS5 now. Watch it to the end, wait 10 seconds on the menu, then press Ctrl+C.'
    : 'Press Start on PS5 now and drive. After the finish or abort, wait 10 seconds, then press Ctrl+C.';
}

async function main() {
  const args = readArguments();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = resolve('data', 'raw');
  mkdirSync(directory, { recursive: true });
  const rawPath = join(directory, `${stamp}-${args.purpose}.ndjson`);
  const captureId = randomUUID();
  const startedUnixMs = Date.now();
  const startedMono = performance.now();
  const sinceStart = () => performance.now() - startedMono;
  const writer = new RawWriter(rawPath, captureId);
  const stats = new TelemetryStats();
  const source = new UdpSource({ ps5Ip: args.ip, now: sinceStart });
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onDatagram = (datagram: Datagram) => {
    if (stats.result().datagrams === 0) console.log(`First datagram: ${datagram.payload.byteLength} bytes.`);
    writer.append(datagram);
    stats.add(datagram);
  };

  let stopping = false;
  const stop = async (reason: string) => {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer);
    clearInterval(status);
    await source.stop();
    const written = await writer.close();
    const summary = {
      schemaVersion: 1,
      captureId,
      purpose: args.purpose,
      ps5Ip: args.ip,
      startedUnixMs,
      durationMs: sinceStart(),
      reason,
      complete: written.complete,
      incompleteReason: written.reason,
      packetsWritten: written.packets,
      rejectedWrites: writer.appended - written.packets,
      foreignDatagramsIgnored: source.foreignDatagrams,
      heartbeatErrors: source.heartbeatErrors,
      telemetry: stats.result(),
      rawFile: relative(process.cwd(), rawPath)
    };
    writeFileSync(`${rawPath}.summary.json`, JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = written.complete && summary.telemetry.datagrams > 0 ? 0 : 1;
  };

  const status = setInterval(() => console.log(stats.statusLine()), 2000);
  await source.start(onDatagram).catch(error => {
    clearInterval(status);
    throw error;
  });
  console.log(`Listening on UDP 33740 for ${args.ip}, ${args.seconds} s, purpose ${args.purpose}, packet format C.`);
  console.log(`Raw output: ${relative(process.cwd(), rawPath)}`);
  console.log(instruction(args.purpose));
  timer = setTimeout(() => void stop('duration-complete'), args.seconds * 1000);
  process.once('SIGINT', () => void stop('user-stopped'));
  process.once('SIGTERM', () => void stop('terminated'));
}

await main();
