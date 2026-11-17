import type { Catalogue, CatalogueEntry, CatalogueSource } from '@gt7/contracts';
import { MANUAL_ENTRIES } from './manual.ts';
import {
  CIRCUIT_EXPERIENCE_PAGE,
  LICENCE_PAGES,
  circuitLookup,
  parseCars,
  parseCircuitExperience,
  parseCircuits,
  parseCsv,
  parseLicencePage,
  type CsvRow
} from './parse.ts';
import { validateCatalogue } from './validate.ts';

export const GT7INFO_BASE_URL = 'https://raw.githubusercontent.com/ddm999/gt7info/web-new/_data/db/';
export const WIKI_API_URL = 'https://gran-turismo.fandom.com/api.php';
export const CLIENT_HEADERS: Readonly<Record<string, string>> = { 'User-Agent': 'gt7-tutor-catalogue' };
export const GT7INFO_TABLES = ['course.csv', 'crsbase.csv', 'country.csv', 'cars.csv', 'maker.csv'] as const;

export const CATALOGUE_SOURCES: CatalogueSource[] = [
  { name: 'ddm999/gt7info: circuits and cars', licence: 'MIT-0', url: 'https://github.com/ddm999/gt7info' },
  { name: 'Gran Turismo Wiki: licence tests and Circuit Experience', licence: 'CC BY-SA', url: 'https://gran-turismo.fandom.com' }
];

export const DEFAULT_GAME_VERSION_NOTE =
  'Target times as listed by the Gran Turismo Wiki on the retrieval date. The game version of these times is not confirmed.';

export class CatalogueSourceError extends Error {
  readonly source: string;
  readonly reason: string;

  constructor(source: string, reason: string) {
    super(`${source}: ${reason}`);
    this.source = source;
    this.reason = reason;
  }
}

export type FetchCatalogueOptions = {
  fetch: typeof fetch;
  aliases: Record<string, number>;
  timeoutMs: number;
  now?: () => Date;
  gameVersionNote?: string;
};

export function gt7infoUrl(table: string): string {
  return GT7INFO_BASE_URL + table;
}

export function wikiPageUrl(page: string): string {
  return `${WIKI_API_URL}?action=parse&prop=wikitext&format=json&page=${encodeURIComponent(page)}`;
}

function failureReason(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return `no answer within ${timeoutMs} ms`;
  return error instanceof Error ? error.message : String(error);
}

async function download(options: FetchCatalogueOptions, signal: AbortSignal, source: string, url: string): Promise<Response> {
  let response: Response;
  try {
    response = await options.fetch(url, { headers: { ...CLIENT_HEADERS }, signal, redirect: 'follow' });
  } catch (error) {
    throw new CatalogueSourceError(source, failureReason(error, options.timeoutMs));
  }
  if (!response.ok) throw new CatalogueSourceError(source, `HTTP ${response.status}`);
  return response;
}

async function readBody<T>(source: string, timeoutMs: number, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new CatalogueSourceError(source, failureReason(error, timeoutMs));
  }
}

async function table(options: FetchCatalogueOptions, signal: AbortSignal, name: string): Promise<CsvRow[]> {
  const source = `gt7info ${name}`;
  const response = await download(options, signal, source, gt7infoUrl(name));
  const rows = parseCsv(await readBody(source, options.timeoutMs, () => response.text()));
  if (rows.length === 0) throw new CatalogueSourceError(source, 'the table is empty');
  return rows;
}

function wikitextOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('parse' in body)) return null;
  const parse = (body as { parse?: { wikitext?: Record<string, unknown> } }).parse;
  const text = parse?.wikitext?.['*'];
  return typeof text === 'string' ? text : null;
}

async function wikiPage(options: FetchCatalogueOptions, signal: AbortSignal, page: string): Promise<string> {
  const source = `Gran Turismo Wiki page "${page}"`;
  const response = await download(options, signal, source, wikiPageUrl(page));
  const body: unknown = await readBody(source, options.timeoutMs, () => response.json());
  const text = wikitextOf(body);
  if (text === null) throw new CatalogueSourceError(source, 'the answer contains no page source');
  return text;
}

function requireEntries(source: string, entries: CatalogueEntry[]): CatalogueEntry[] {
  if (entries.length === 0) throw new CatalogueSourceError(source, 'no entries found; the page format may have changed');
  return entries;
}

export async function fetchCatalogue(options: FetchCatalogueOptions): Promise<Catalogue> {
  const signal = AbortSignal.timeout(options.timeoutMs);
  const [tables, licencePages, circuitExperiencePage] = await Promise.all([
    Promise.all(GT7INFO_TABLES.map(name => table(options, signal, name))),
    Promise.all(LICENCE_PAGES.map(licence => wikiPage(options, signal, licence.page))),
    wikiPage(options, signal, CIRCUIT_EXPERIENCE_PAGE)
  ]);
  const [course, bases, countries, cars, makers] = tables;
  const circuits = parseCircuits(course!, bases!, countries!);
  const findCircuit = circuitLookup(circuits, options.aliases);
  const licenceEntries = LICENCE_PAGES.flatMap((licence, index) =>
    requireEntries(`Gran Turismo Wiki page "${licence.page}"`, parseLicencePage(licencePages[index]!, licence, findCircuit))
  );
  const circuitExperienceEntries = requireEntries(
    `Gran Turismo Wiki page "${CIRCUIT_EXPERIENCE_PAGE}"`,
    parseCircuitExperience(circuitExperiencePage, findCircuit)
  );
  return validateCatalogue({
    schemaVersion: 1,
    retrieved: (options.now ?? (() => new Date()))().toISOString(),
    gameVersionNote: options.gameVersionNote ?? DEFAULT_GAME_VERSION_NOTE,
    circuits,
    cars: parseCars(cars!, makers!),
    entries: [...MANUAL_ENTRIES, ...licenceEntries, ...circuitExperienceEntries]
  });
}
