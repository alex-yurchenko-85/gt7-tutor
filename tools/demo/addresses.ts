import { renderUnicodeCompact } from 'uqr';

export type NetworkInterfaceInfo = { address: string; family: string | number; internal: boolean };

export type ReadyMessageInput = { port: number; lan: string[]; profileName: string; password: string };

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

function phoneLines(port: number, lan: string[]): string[] {
  const address = lan[0];
  if (address === undefined) {
    return ['No network address was found. A phone cannot connect. Check that this computer is on your home network.'];
  }
  const phoneUrl = `http://${address}:${port}`;
  return [`On a phone on the same network, open: ${phoneUrl}`, 'Or scan this code with the phone camera:', '', renderUnicodeCompact(phoneUrl), ''];
}

export function readyMessage({ port, lan, profileName, password }: ReadyMessageInput): string {
  return [
    '',
    'GT7 Tutor demo is ready. It uses recorded data. No console is needed.',
    '',
    `On this computer, open: http://localhost:${port}`,
    ...phoneLines(port, lan),
    `Sign in with profile "${profileName}" and password "${password}".`,
    '',
    'For voice on a phone: in Setup, tap "Use this device for voice" once, and do not let the screen lock during an attempt.',
    'These limits come from the phone browser.',
    '',
    'Press Ctrl+C to stop the demo.',
    ''
  ].join('\n');
}
