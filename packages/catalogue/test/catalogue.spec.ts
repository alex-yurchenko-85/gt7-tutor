import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CLIENT_HEADERS,
  CatalogueSourceError,
  CatalogueValidationError,
  diffCatalogue,
  fetchCatalogue,
  lapTimeMs,
  parseCsv,
  slug,
  validateCatalogue
} from '../src/index.ts';

const sourcesDir = new URL('../../../fixtures/catalogue-sources/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', sourcesDir), 'utf8')) as Record<string, string>;
const aliases = JSON.parse(readFileSync(new URL('../../../catalogue/aliases.json', import.meta.url), 'utf8')) as Record<string, number>;

function recordedFetch(seen: { url: string; headers: Headers }[] = []): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    seen.push({ url, headers: new Headers(init?.headers) });
    const file = index[url];
    if (!file) return new Response('not found', { status: 404 });
    return new Response(readFileSync(new URL(file, sourcesDir), 'utf8'), { status: 200 });
  };
}

const fixedNow = () => new Date('2026-11-16T12:00:00.000Z');

describe('catalogue sources', () => {
  it('csv_handles_quotes_and_crlf', () => {
    expect(parseCsv('ID,Name\r\n1,"Big, ""Quoted"""\r\n2,Plain\r\n')).toEqual([
      { ID: '1', Name: 'Big, "Quoted"' },
      { ID: '2', Name: 'Plain' }
    ]);
  });

  it('lap_time_and_slug', () => {
    expect(lapTimeMs('1:02.345 (1:03.000 prior to 1.71)')).toBe(62345);
    expect(lapTimeMs(null)).toBeNull();
    expect(slug("Fisherman's Ranch")).toBe('fishermans-ranch');
    expect(slug('Autódromo de Interlagos')).toBe('autodromo-de-interlagos');
  });

  it('recorded_sources_give_the_seed_catalogue', async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const catalogue = await fetchCatalogue({ fetch: recordedFetch(seen), aliases, timeoutMs: 1000, now: fixedNow });
    const licences = catalogue.entries.filter(entry => entry.family === 'Licence');
    expect(licences).toHaveLength(100);
    expect(licences.every(entry => entry.targets !== null)).toBe(true);
    expect(catalogue.entries.filter(entry => entry.family === 'Circuit Experience').length).toBeGreaterThanOrEqual(56);
    expect(catalogue.circuits.length).toBeGreaterThanOrEqual(122);
    expect(catalogue.cars.find(car => car.id === 3602)?.name).toBe("Yangwang U9 '24");
    expect(catalogue.entries.find(entry => entry.id === 'licence-b-1')).toMatchObject({
      code: 'B-1',
      track: 'High Speed Ring',
      circuitId: 11,
      targets: { bronzeMs: 22800, silverMs: 21400, goldMs: 20800 }
    });
    expect(catalogue.entries.filter(entry => 'support' in entry)).toEqual([]);
    expect(seen.every(request => [...request.headers.keys()].join() === 'user-agent')).toBe(true);
    expect(seen.every(request => request.headers.get('user-agent') === CLIENT_HEADERS['User-Agent'])).toBe(true);
  });

  it('failed_source_names_the_page', async () => {
    const failing: typeof fetch = async (input, init) =>
      String(input).includes('Master%20S') ? new Response('', { status: 500 }) : recordedFetch()(input, init);
    await expect(fetchCatalogue({ fetch: failing, aliases, timeoutMs: 1000 })).rejects.toThrow(
      new CatalogueSourceError('Gran Turismo Wiki page "GT7 Master S-License"', 'HTTP 500')
    );
  });

  it('slow_source_times_out', async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    await expect(fetchCatalogue({ fetch: hanging, aliases, timeoutMs: 50 })).rejects.toThrow('no answer within 50 ms');
  });

  it('validation_names_the_failing_path', () => {
    expect(() => validateCatalogue({ schemaVersion: 1, retrieved: 'yesterday' })).toThrow(CatalogueValidationError);
    expect(() => validateCatalogue({ schemaVersion: 1, retrieved: 'yesterday' })).toThrow(/retrieved/);
  });

  it('diff_reports_added_removed_changed_and_family_loss', async () => {
    const current = await fetchCatalogue({ fetch: recordedFetch(), aliases, timeoutMs: 1000, now: fixedNow });
    const licences = current.entries.filter(entry => entry.family === 'Licence');
    const changedEntry = { ...licences[0]!, name: 'Renamed' };
    const extra = { ...licences[1]!, id: 'licence-new-1', code: 'NEW-1' };
    const next = { ...current, entries: [changedEntry, ...current.entries.filter(entry => entry.id !== licences[0]!.id && entry.id !== licences[2]!.id), extra] };
    const diff = diffCatalogue(current, next);
    expect(diff.added.map(entry => entry.id)).toEqual(['licence-new-1']);
    expect(diff.removed.map(entry => entry.id)).toEqual([licences[2]!.id]);
    expect(diff.changed).toEqual([{ id: licences[0]!.id, fields: ['name'] }]);
    expect(diff.rejected).toBeNull();

    const dropped = new Set(licences.slice(0, 21).map(entry => entry.id));
    const shrunk = { ...current, entries: current.entries.filter(entry => !dropped.has(entry.id)) };
    expect(diffCatalogue(current, shrunk).rejected).toContain('21 of 100 Licence');
    const twenty = new Set(licences.slice(0, 20).map(entry => entry.id));
    expect(diffCatalogue(current, { ...current, entries: current.entries.filter(entry => !twenty.has(entry.id)) }).rejected).toBeNull();
  });
});
