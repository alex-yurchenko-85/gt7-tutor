import { renderUnicodeCompact } from 'uqr';
import { describe, expect, it } from 'vitest';
import { lanAddresses, pnpmCommand, readyBlock } from './ready.ts';

const LOG_PATH = 'data/logs/2026-11-19_12-04-31.log';
const INDENT = ' '.repeat(19);

function qrLines(url: string): string[] {
  return renderUnicodeCompact(url)
    .split('\n')
    .map(line => `${INDENT}${line}`);
}

describe('ready block', () => {
  it('normal_mode_prints_the_exact_block', () => {
    const text = readyBlock({ port: 3001, lan: ['192.0.2.10'], logPath: LOG_PATH, demo: null, qr: renderUnicodeCompact });
    const expected = [
      '✓ Server started',
      '',
      'On this computer:  http://localhost:3001',
      'On your phone:     http://192.0.2.10:3001',
      ...qrLines('http://192.0.2.10:3001'),
      '',
      `Log of this start: ${LOG_PATH}`,
      'Press Ctrl+C to stop.'
    ].join('\n');
    expect(text).toBe(expected);
  });

  it('demo_mode_adds_the_sign_in_line', () => {
    const text = readyBlock({ port: 3001, lan: ['192.0.2.10'], logPath: LOG_PATH, demo: { profileName: 'demo', password: 'demodemo' }, qr: renderUnicodeCompact });
    const expected = [
      '✓ Server started',
      '',
      'On this computer:  http://localhost:3001',
      'On your phone:     http://192.0.2.10:3001',
      ...qrLines('http://192.0.2.10:3001'),
      '',
      'Sign in with profile "demo" and password "demodemo".',
      '',
      `Log of this start: ${LOG_PATH}`,
      'Press Ctrl+C to stop.'
    ].join('\n');
    expect(text).toBe(expected);
  });

  it('qr_code_uses_block_characters_and_many_lines', () => {
    const lines = readyBlock({ port: 3001, lan: ['192.0.2.10'], logPath: LOG_PATH, demo: null, qr: renderUnicodeCompact }).split('\n');
    const qr = lines.filter(line => line.startsWith(INDENT));
    expect(qr.length).toBeGreaterThan(10);
    expect(qr[0]!.slice(INDENT.length)).toMatch(/^[█▀▄ ]/);
    expect(qr[0]!.slice(INDENT.length)).toMatch(/[█▀▄]/);
  });

  it('first_lan_address_is_the_phone_link', () => {
    const text = readyBlock({ port: 3001, lan: ['192.0.2.10', '192.0.2.11'], logPath: LOG_PATH, demo: null, qr: renderUnicodeCompact });
    expect(text).toContain('http://192.0.2.10:3001');
    expect(text).not.toContain('192.0.2.11');
  });

  it('without_a_lan_address_there_is_no_qr_code', () => {
    const text = readyBlock({ port: 3001, lan: [], logPath: LOG_PATH, demo: null, qr: renderUnicodeCompact });
    expect(text).toBe(
      [
        '✓ Server started',
        '',
        'On this computer:  http://localhost:3001',
        'On your phone:     no network address found. Check that this computer is on your home network.',
        '',
        `Log of this start: ${LOG_PATH}`,
        'Press Ctrl+C to stop.'
      ].join('\n')
    );
    expect(text).not.toMatch(/[█▀▄]/);
  });
});

describe('lan addresses', () => {
  it('lan_addresses_skip_internal_and_ipv6', () => {
    const interfaces = {
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      en0: [
        { address: 'fe80::1', family: 'IPv6', internal: false },
        { address: '203.0.113.5', family: 'IPv4', internal: false }
      ],
      en1: [{ address: '192.168.1.20', family: 'IPv4', internal: false }]
    };
    expect(lanAddresses(interfaces)).toEqual(['192.168.1.20', '203.0.113.5']);
  });
});

describe('pnpm command', () => {
  it('uses_pnpm_when_it_is_on_the_path', () => {
    expect(pnpmCommand({ pnpmOnPath: true, packageManager: 'pnpm@12.21.0' })).toEqual({ command: 'pnpm', prefix: [] });
  });

  it('uses_npx_with_the_exact_version_otherwise', () => {
    expect(pnpmCommand({ pnpmOnPath: false, packageManager: 'pnpm@12.21.0' })).toEqual({ command: 'npx', prefix: ['--yes', 'pnpm@12.21.0'] });
  });

  it('throws_for_another_package_manager', () => {
    expect(() => pnpmCommand({ pnpmOnPath: true, packageManager: 'yarn@4.0.0' })).toThrow('The packageManager value "yarn@4.0.0" is not pnpm@<version>.');
  });

  it('throws_for_a_missing_version', () => {
    expect(() => pnpmCommand({ pnpmOnPath: false, packageManager: 'pnpm' })).toThrow('The packageManager value "pnpm" is not pnpm@<version>.');
  });
});
