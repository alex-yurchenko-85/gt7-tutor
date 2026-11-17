export type Runner = {
  run(command: string, args: string[], quiet?: boolean): Promise<number>;
  exists(path: string): boolean;
  copy(from: string, to: string): void;
  print(line: string): void;
  nodeVersion(): string;
};

export type SetupOptions = { demo: boolean };

type Step = { title: string; act(runner: Runner): Promise<string | null> };

const NODE_MAJOR_MIN = 26;
const STEP_COUNT = 7;

function command(line: string): (runner: Runner) => Promise<string | null> {
  const [name, ...args] = line.split(' ');
  return async runner => ((await runner.run(name!, args)) === 0 ? null : `"${line}" failed. Read the messages above.`);
}

const STEPS: Step[] = [
  {
    title: 'checking Node.js',
    act: async runner => {
      const major = Number(runner.nodeVersion().replace(/^v/, '').split('.')[0]);
      return major >= NODE_MAJOR_MIN ? null : `Node.js ${NODE_MAJOR_MIN} or later is required. Install it from https://nodejs.org/en/download`;
    }
  },
  {
    title: 'checking Docker',
    act: async runner =>
      (await runner.run('docker', ['info'], true)) === 0
        ? null
        : 'Docker is not running. Start Docker Desktop (macOS) or the Docker service (Linux), then run this command again.'
  },
  {
    title: 'preparing the settings file',
    act: async runner => {
      if (runner.exists('.env')) runner.print('Kept your existing .env');
      else {
        runner.copy('.env.example', '.env');
        runner.print('Created .env from .env.example');
      }
      return null;
    }
  },
  { title: 'installing packages', act: command('pnpm install --frozen-lockfile') },
  { title: 'starting the database', act: command('pnpm db:up') },
  { title: 'preparing the database', act: command('pnpm db:migrate') },
  { title: 'building the application', act: command('pnpm build') }
];

export async function setupLocal(runner: Runner, options: SetupOptions): Promise<number> {
  for (const [index, step] of STEPS.entries()) {
    const label = `Step ${index + 1} of ${STEP_COUNT}`;
    runner.print(`${label}: ${step.title}`);
    const problem = await step.act(runner);
    if (problem) {
      runner.print(problem);
      runner.print(`${label} failed: ${step.title}.`);
      return 1;
    }
  }
  if (options.demo) {
    runner.print('Starting the demo.');
    return (await runner.run('pnpm', ['demo'])) === 0 ? 0 : 1;
  }
  runner.print('Ready. Start the application with: pnpm start');
  runner.print('Then open http://localhost:3000');
  return 0;
}
