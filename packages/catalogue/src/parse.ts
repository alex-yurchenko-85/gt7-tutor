import type { Car, CatalogueEntry, Circuit } from '@gt7/contracts';

export type CsvRow = Record<string, string>;

function csvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records.filter(row => !(row.length === 1 && row[0]!.trim() === ''));
}

export function parseCsv(text: string): CsvRow[] {
  const [header, ...rows] = csvRecords(text.replace(/^﻿/, ''));
  if (!header) return [];
  const names = header.map(name => name.trim());
  return rows.map(row => Object.fromEntries(names.map((name, index) => [name, (row[index] ?? '').trim()])));
}

function optionalNumber(value: string | undefined): number | null {
  if (value === undefined || value === '' || value === '?') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveOrNull(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

function wholeOrNull(value: number | null): number | null {
  return value !== null && Number.isInteger(value) && value >= 0 ? value : null;
}

function nonEmpty(value: string | undefined): string | null {
  return value && value.length > 0 ? value : null;
}

export function parseCircuits(course: CsvRow[], bases: CsvRow[], countries: CsvRow[]): Circuit[] {
  const baseName = new Map(bases.map(base => [base.ID, base.Name]));
  const countryName = new Map(countries.map(country => [country.ID, country.Name]));
  return course.map(row => ({
    id: Number(row.ID),
    name: row.Name ?? '',
    location: nonEmpty(baseName.get(row.Base)),
    country: nonEmpty(countryName.get(row.Country)),
    category: row.Category || 'unknown',
    lengthM: positiveOrNull(optionalNumber(row.Length)),
    corners: wholeOrNull(optionalNumber(row.NumCorners)),
    reverse: row.IsReverse === '1',
    oval: row.IsOval === '1'
  }));
}

export function parseCars(cars: CsvRow[], makers: CsvRow[]): Car[] {
  const makerName = new Map(makers.map(maker => [maker.ID, maker.Name]));
  return cars.map(row => {
    const maker = makerName.get(row.Maker);
    const shortName = row.ShortName ?? '';
    return { id: Number(row.ID), name: maker ? `${maker} ${shortName}` : shortName };
  });
}

export function plainWikiText(text: string): string {
  return text
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

export function slug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function lapTimeMs(text: string | null): number | null {
  const match = text?.match(/(\d+):(\d{2})\.(\d{3})/);
  if (!match) return null;
  return Number(match[1]) * 60000 + Number(match[2]) * 1000 + Number(match[3]);
}

export type CircuitLookup = (track: string) => number | null;

export function circuitLookup(circuits: Circuit[], aliases: Record<string, number>): CircuitLookup {
  const bySlug = new Map(circuits.map(circuit => [slug(circuit.name), circuit.id]));
  const knownIds = new Set(circuits.map(circuit => circuit.id));
  return track => {
    const alias = aliases[track];
    if (alias !== undefined) return knownIds.has(alias) ? alias : null;
    return bySlug.get(slug(track)) ?? bySlug.get(slug(track.replace(' - ', ' '))) ?? null;
  };
}

export type LicencePage = { page: string; collection: string };

export const LICENCE_PAGES: LicencePage[] = [
  { page: 'GT7 B-License', collection: 'National B' },
  { page: 'GT7 A-License', collection: 'National A' },
  { page: 'GT7 International B-License', collection: 'International B' },
  { page: 'GT7 International A-License', collection: 'International A' },
  { page: 'GT7 S-License', collection: 'Super' },
  { page: 'GT7 Master B-License', collection: 'Master B' },
  { page: 'GT7 Master A-License', collection: 'Master A' },
  { page: 'GT7 Master International B-License', collection: 'Master International B' },
  { page: 'GT7 Master International A-License', collection: 'Master International A' },
  { page: 'GT7 Master S-License', collection: 'Master Super' }
];

export const CIRCUIT_EXPERIENCE_PAGE = 'Circuit Experience';

function listField(body: string, label: string): string | null {
  const match = body.match(new RegExp(`^\\*\\s*${label}[^:\\n]*:\\s*(.+)$`, 'mi'));
  return match ? nonEmpty(plainWikiText(match[1]!)) : null;
}

function levelTwoSections(wikitext: string): { heading: string; body: string }[] {
  const parts = wikitext.split(/^==([^=].*?)==\s*$/m).slice(1);
  const sections: { heading: string; body: string }[] = [];
  for (let index = 0; index + 1 < parts.length; index += 2) sections.push({ heading: parts[index]!.trim(), body: parts[index + 1]! });
  return sections;
}

export function parseLicencePage(wikitext: string, licence: LicencePage, findCircuit: CircuitLookup): CatalogueEntry[] {
  return levelTwoSections(wikitext)
    .filter(section => /\d$/.test(section.heading))
    .map(({ heading: code, body }) => {
      const track = listField(body, 'Track');
      return {
        id: `licence-${slug(code)}`,
        family: 'Licence',
        collection: licence.collection,
        code,
        name: plainWikiText(body.match(/^'''(.+?)'''/m)?.[1] ?? code),
        track,
        circuitId: track ? findCircuit(track) : null,
        car: listField(body, 'Car'),
        targetMs: lapTimeMs(listField(body, 'Gold')),
        source: `Gran Turismo Wiki: ${licence.page}`
      };
    });
}

function gt7Section(wikitext: string): string {
  const start = wikitext.search(/^==\s*Gran Turismo 7\s*==\s*$/m);
  if (start < 0) return '';
  const rest = wikitext.slice(start);
  const next = rest.slice(2).search(/^==[^=].*==\s*$/m);
  return next < 0 ? rest : rest.slice(0, next + 2);
}

const LAP_ATTACK = '1 Lap Attack';

function circuitExperienceTasks(sections: number): { id: string; code: string }[] {
  const sectors = Array.from({ length: Math.max(sections - 1, 0) }, (_, index) => ({ id: `s${index + 1}`, code: `Sector ${index + 1}` }));
  return [...sectors, { id: 'lap', code: LAP_ATTACK }];
}

export function parseCircuitExperience(wikitext: string, findCircuit: CircuitLookup): CatalogueEntry[] {
  const entries: CatalogueEntry[] = [];
  let region = '';
  for (const line of gt7Section(wikitext).split('\n')) {
    const heading = line.match(/^!\s*colspan=\d+\s*\|\s*(.+)$/);
    if (heading) {
      region = plainWikiText(heading[1]!);
      continue;
    }
    const row = line.match(/^\|\s*(.+?)\s*\|\|\s*(\d+)\s*\|\|\s*(.+?)\s*\|\|/);
    if (!row) continue;
    const track = plainWikiText(row[1]!);
    const base = {
      family: 'Circuit Experience',
      collection: region || 'Circuit Experience',
      track,
      circuitId: findCircuit(track),
      car: nonEmpty(plainWikiText(row[3]!)),
      targetMs: null,
      source: `Gran Turismo Wiki: ${CIRCUIT_EXPERIENCE_PAGE}`
    };
    for (const task of circuitExperienceTasks(Number(row[2]))) {
      entries.push({ id: `ce-${slug(track)}-${task.id}`, code: task.code, name: `${track} · ${task.code}`, ...base });
    }
  }
  return entries;
}
