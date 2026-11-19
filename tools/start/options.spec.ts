import { describe, expect, it } from 'vitest';
import { parseStartOptions } from './options.ts';

describe('parseStartOptions', () => {
  it('start_options_default_to_off_and_port_from_env', () => {
    expect(parseStartOptions([])).toEqual({ demo: false, reset: false, check: false, port: null });
  });

  it('start_options_read_all_flags_and_port', () => {
    expect(parseStartOptions(['--demo', '--reset', '--check', '--port', '3002'])).toEqual({ demo: true, reset: true, check: true, port: 3002 });
  });

  it.each(['0', 'x', '65536', '1.5', '-3'])('start_options_reject_port_%s', value => {
    expect(() => parseStartOptions(['--port', value])).toThrow(`Invalid port: ${value}`);
  });

  it('start_options_reject_missing_port_value', () => {
    expect(() => parseStartOptions(['--port'])).toThrow('Invalid port: ');
  });

  it('start_options_reject_unknown_option', () => {
    expect(() => parseStartOptions(['--verbose'])).toThrow('Unknown option: --verbose. Options: --demo, --reset, --port <n>, --check.');
  });
});
