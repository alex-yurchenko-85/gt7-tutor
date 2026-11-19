export type NetworkInterfaceInfo = { address: string; family: string | number; internal: boolean };

export type ReadyInput = {
  port: number;
  lan: string[];
  logPath: string;
  demo: { profileName: string; password: string } | null;
  qr: (text: string) => string;
};

const INDENT = ' '.repeat(19);

function isPrivate(address: string): boolean {
  const [first, second] = address.split('.').map(Number);
  return first === 10 || (first === 192 && second === 168) || (first === 172 && second! >= 16 && second! <= 31);
}

export function lanAddresses(interfaces: Record<string, NetworkInterfaceInfo[] | undefined>): string[] {
  const addresses = Object.values(interfaces)
    .flatMap(entries => entries ?? [])
    .filter(entry => !entry.internal && (entry.family === 'IPv4' || entry.family === 4))
    .map(entry => entry.address);
  return [...addresses.filter(isPrivate), ...addresses.filter(address => !isPrivate(address))];
}

function phoneLines(port: number, lan: string[], qr: (text: string) => string): string[] {
  const address = lan[0];
  if (address === undefined) {
    return ['On your phone:     no network address found. Check that this computer is on your home network.'];
  }
  const phoneUrl = `http://${address}:${port}`;
  const code = qr(phoneUrl)
    .split('\n')
    .map(line => `${INDENT}${line}`);
  return [`On your phone:     ${phoneUrl}`, ...code];
}

export function readyBlock({ port, lan, logPath, demo, qr }: ReadyInput): string {
  return [
    '✓ Server started',
    '',
    `On this computer:  http://localhost:${port}`,
    ...phoneLines(port, lan, qr),
    '',
    ...(demo === null ? [] : [`Sign in with profile "${demo.profileName}" and password "${demo.password}".`, '']),
    `Log of this start: ${logPath}`,
    'Press Ctrl+C to stop.'
  ].join('\n');
}

export function pnpmCommand({ pnpmOnPath, packageManager }: { pnpmOnPath: boolean; packageManager: string }): {
  command: string;
  prefix: string[];
} {
  if (!/^pnpm@\d[^\s@]*$/.test(packageManager)) {
    throw new Error(`The packageManager value "${packageManager}" is not pnpm@<version>.`);
  }
  return pnpmOnPath ? { command: 'pnpm', prefix: [] } : { command: 'npx', prefix: ['--yes', packageManager] };
}
