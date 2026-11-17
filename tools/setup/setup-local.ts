import { spawn } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setupLocal, type Runner } from './setup-steps.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const realRunner: Runner = {
  run: (command, args, quiet = false) =>
    new Promise(resolve => {
      const child = spawn(command, args, { cwd: repoRoot, stdio: quiet ? 'ignore' : 'inherit', shell: process.platform === 'win32' });
      child.once('error', () => resolve(127));
      child.once('exit', code => resolve(code ?? 1));
    }),
  exists: path => existsSync(join(repoRoot, path)),
  copy: (from, to) => copyFileSync(join(repoRoot, from), join(repoRoot, to)),
  print: line => console.log(line),
  nodeVersion: () => process.versions.node
};

const { values } = parseArgs({ options: { demo: { type: 'boolean', default: false } } });
process.exitCode = await setupLocal(realRunner, { demo: values.demo });
