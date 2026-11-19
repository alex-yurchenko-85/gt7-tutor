import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const builtMain = fileURLToPath(new URL('../../dist/main.js', import.meta.url));

export function tempDir(): string {
  return mkdtempSync(join(process.env.GT7_TEST_TEMP_ROOT ?? tmpdir(), 'gt7-server-'));
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

export type RunningServer = { child: ChildProcess; output: () => string; exited: Promise<number | null> };

export function startBuiltServer(env: Record<string, string>, cwd: string): RunningServer {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !['DATABASE_URL', 'HTTP_HOST', 'HTTP_PORT', 'DATA_DIR', 'TELEMETRY_SOURCE', 'DEV_REPLAY', 'CATALOGUE_DIR', 'CATALOGUE_TIMEOUT_MS', 'AUDIO_DIR', 'FIXTURES_DIR'].includes(key))
  );
  const child = spawn(process.execPath, [builtMain], { cwd, env: { ...inherited, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  child.stdout?.on('data', chunk => (text += chunk));
  child.stderr?.on('data', chunk => (text += chunk));
  const exited = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)));
  return { child, output: () => text, exited };
}

export async function waitForHealth(url: string, timeoutMs = 20000): Promise<Response> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      return await fetch(url);
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error(`No response from ${url}`);
}
