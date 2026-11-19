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
const aliases = JSON.parse(readFileSync(new URL('../../../content/catalogue/aliases.json', import.meta.url), 'utf8')) as Record<string, number>;

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
    const brandCentral = catalogue.entries.filter(entry => entry.family === 'Brand Central');
    expect(brandCentral.map(entry => `${entry.collection} ${entry.code}`)).toEqual(
      ['Hyundai', 'Polestar', 'Xiaomi', 'Yangwang'].flatMap(brand => [1, 2, 3, 4, 5].map(number => `${brand} EXP-${number}`))
    );
    expect(brandCentral.map(entry => entry.id).filter(id => !/^brand-[a-z]+-exp-[1-5]$/.test(id))).toEqual(['brand-yangwang-racing-lines']);
    expect(brandCentral.find(entry => entry.id === 'brand-yangwang-racing-lines')).toEqual({
      id: 'brand-yangwang-racing-lines',
      family: 'Brand Central',
      collection: 'Yangwang',
      code: 'EXP-1',
      name: 'Racing Line: Intermediate',
      track: 'SUGO International Racing Course',
      circuitId: null,
      car: "Yangwang U9 '24",
      targets: { bronzeMs: 26000, silverMs: 24200, goldMs: 23500 },
      sections: null,
      source: 'Game screen and Gran Turismo Wiki: SUGO International Racing Course'
    });
    expect(brandCentral.find(entry => entry.id === 'brand-xiaomi-exp-4')).toMatchObject({
      name: 'Cornering: Expert',
      track: 'Alsace - Village',
      circuitId: 358,
      car: 'Xiaomi Xiaomi VGT',
      targets: { bronzeMs: 39700, silverMs: 36600, goldMs: 35600 }
    });
    expect(brandCentral.find(entry => entry.id === 'brand-yangwang-exp-4')).toMatchObject({
      name: 'Cornering: Expert',
      track: 'Trial Mountain Circuit',
      targets: { bronzeMs: 44400, silverMs: 41300, goldMs: 40000 },
      source: 'Game screen'
    });
    expect(brandCentral.find(entry => entry.id === 'brand-hyundai-exp-5')).toMatchObject({
      name: 'Final Exam',
      track: 'Alsace - Village Reverse',
      circuitId: 439,
      car: "Hyundai IONIQ 6N '25",
      targets: null
    });
    expect(brandCentral.filter(entry => entry.code === 'EXP-5' && entry.targets !== null)).toEqual([]);
    expect(brandCentral.filter(entry => entry.code !== 'EXP-5' && entry.targets === null)).toEqual([]);
    expect(catalogue.entries.filter(entry => entry.family === 'Brand Experience')).toEqual([]);
    expect(brandCentral[0]).toEqual({
      id: 'brand-hyundai-exp-1',
      family: 'Brand Central',
      collection: 'Hyundai',
      code: 'EXP-1',
      name: 'Cornering: Intermediate',
      track: 'Suzuka Circuit',
      circuitId: 10,
      car: "Hyundai IONIQ 5 N '24",
      targets: { bronzeMs: 20400, silverMs: 18900, goldMs: 18400 },
      sections: null,
      source: 'Game screen and Gran Turismo Wiki: Suzuka Circuit'
    });
    expect(brandCentral[3]).toMatchObject({
      code: 'EXP-4',
      name: 'Cornering: Expert',
      track: 'SUGO International Racing Course',
      car: "Hyundai IONIQ 6N '25",
      targets: { bronzeMs: 37000, silverMs: 34400, goldMs: 33400 }
    });
    const carNames = new Set(catalogue.cars.map(car => car.name));
    expect(brandCentral.filter(entry => entry.car === null || !carNames.has(entry.car))).toEqual([]);
    const circuitIds = new Set(catalogue.circuits.map(circuit => circuit.id));
    expect(brandCentral.filter(entry => entry.circuitId !== null && !circuitIds.has(entry.circuitId))).toEqual([]);
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
