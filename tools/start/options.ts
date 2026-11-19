export type StartOptions = { demo: boolean; reset: boolean; check: boolean; port: number | null };

function parsePort(value: string | undefined): number {
  const text = value ?? '';
  const port = Number(text);
  if (!/^\d+$/.test(text) || port < 1 || port > 65535) throw new Error(`Invalid port: ${text}`);
  return port;
}

export function parseStartOptions(argv: string[]): StartOptions {
  const options: StartOptions = { demo: false, reset: false, check: false, port: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--demo') options.demo = true;
    else if (argument === '--reset') options.reset = true;
    else if (argument === '--check') options.check = true;
    else if (argument === '--port') {
      options.port = parsePort(argv[index + 1]);
      index += 1;
    } else throw new Error(`Unknown option: ${argument}. Options: --demo, --reset, --port <n>, --check.`);
  }
  return options;
}
