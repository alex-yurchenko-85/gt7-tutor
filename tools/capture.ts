import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { RawWriter, UdpSource, type Datagram } from '@gt7/capture';
import { TelemetryStats } from './telemetry-stats.ts';

type Purpose = 'demo' | 'player';

type CaptureArguments = { ip: string; seconds: number; purpose: Purpose; startAfterS: number | null };

const usage = 'Usage: pnpm capture --ip <PS5 IPv4> --purpose demo|player [--seconds 90] [--start-after <s>]';

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
      'start-after': { type: 'string' },
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
  const startAfterS = values['start-after'] === undefined ? null : Number(values['start-after']);
  if (startAfterS !== null && (!Number.isFinite(startAfterS) || startAfterS < 0 || startAfterS >= seconds)) {
    throw new Error('--start-after must be 0 or more and less than --seconds');
  }
  return { ip: values.ip, seconds, purpose: values.purpose, startAfterS };
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
  let startCueMonoMs: number | null = null;
  let rejectedWrites = 0;
  const timers: ReturnType<typeof setTimeout>[] = [];

  const onDatagram = (datagram: Datagram) => {
    if (stats.result().datagrams === 0) console.log(`First datagram: ${datagram.payload.byteLength} bytes.`);
    if (!writer.append(datagram)) rejectedWrites++;
    stats.add(datagram);
  };

  let stopping = false;
  const stop = async (reason: string) => {
    if (stopping) return;
    stopping = true;
    for (const timer of timers) clearTimeout(timer);
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
      startCue: args.startAfterS === null ? null : { requestedDelaySeconds: args.startAfterS, firedMonoMs: startCueMonoMs, confirmedGameAction: false },
      complete: written.complete,
      incompleteReason: written.reason,
      packetsWritten: written.packets,
      rejectedWrites,
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
  if (args.startAfterS === null) {
    console.log(instruction(args.purpose));
  } else {
    console.log(`Wait for START in ${args.startAfterS} s. Do not press anything on PS5 before START.`);
    timers.push(setTimeout(() => {
      startCueMonoMs = sinceStart();
      console.log(`\n\x07========== START ==========\n${instruction(args.purpose)}\n`);
    }, args.startAfterS * 1000));
  }
  timers.push(setTimeout(() => void stop('duration-complete'), args.seconds * 1000));
  process.once('SIGINT', () => void stop('user-stopped'));
  process.once('SIGTERM', () => void stop('terminated'));
}

await main();
