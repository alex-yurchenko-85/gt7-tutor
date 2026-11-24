import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(resolve(import.meta.dirname, '../src/styles/tokens.css'), 'utf8');

function channel(value: number): number {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map(at => channel(parseInt(hex.slice(at, at + 2), 16)));
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

function declared(name: string): string | undefined {
  return new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(CSS)?.[1];
}

function hexOf(block: string, name: string): string | undefined {
  const value = new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
  if (value?.startsWith('#')) return value;
  const variable = /^var\((--[a-z-]+)\)$/.exec(value ?? '')?.[1];
  return variable ? declared(variable) : undefined;
}

const DARK_BLOCKS = CSS.split('}').filter(block => /--soft:\s*#/.test(block) && /--mute:/.test(block) && !/--soft:\s*#fff/.test(block));

describe('dark highlight row contrast', () => {
  it('finds the dark blocks', () => {
    expect(DARK_BLOCKS.length).toBeGreaterThanOrEqual(3);
  });

  it('muted_text_and_red_text_keep_4_5_to_1_on_the_dark_highlight_background', () => {
    for (const block of DARK_BLOCKS) {
      const soft = hexOf(block, '--soft')!;
      expect(contrast(hexOf(block, '--mute')!, soft)).toBeGreaterThanOrEqual(4.5);
      const red = hexOf(block, '--red');
      if (red) expect(contrast(red, soft)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hexOf(block, '--ink')!, soft)).toBeGreaterThanOrEqual(7);
    }
  });
});
