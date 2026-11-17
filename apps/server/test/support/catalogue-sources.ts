import { readFileSync } from 'node:fs';

const sourcesDir = new URL('../../../../fixtures/catalogue-sources/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', sourcesDir), 'utf8')) as Record<string, string>;

export type RecordedRequest = { url: string; headers: Record<string, string> };

export type SourceStub = { fetch: typeof fetch; requests: RecordedRequest[] };

export type WikitextEdit = (page: string, wikitext: string) => string;

function pageOf(url: string): string | null {
  return new URL(url).searchParams.get('page');
}

function editWikiAnswer(body: string, page: string, edit: WikitextEdit): string {
  const answer = JSON.parse(body) as { parse: { wikitext: Record<string, string> } };
  answer.parse.wikitext['*'] = edit(page, answer.parse.wikitext['*']!);
  return JSON.stringify(answer);
}

export function recordedSources(edit?: WikitextEdit): SourceStub {
  const requests: RecordedRequest[] = [];
  const stub: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    const file = index[url];
    if (!file) return new Response('not found', { status: 404 });
    const body = readFileSync(new URL(file, sourcesDir), 'utf8');
    const page = pageOf(url);
    return new Response(page && edit ? editWikiAnswer(body, page, edit) : body, { status: 200 });
  };
  return { fetch: stub, requests };
}

const sectionPattern = /^==([^=].*?)==\s*$/m;

export function keepFirstTests(wikitext: string, count: number): string {
  const parts = wikitext.split(sectionPattern);
  const kept = [parts[0]!];
  for (let index = 1; index + 1 < parts.length && kept.length < 1 + count * 2; index += 2) kept.push(`==${parts[index]}==`, parts[index + 1]!);
  return kept.join('');
}

export function withExtraTest(wikitext: string, code: string): string {
  return `${wikitext}\n==${code}==\n'''Extra Test'''\n*Car: [[Mazda Demio XD Touring '15]]\n*Track: [[High Speed Ring]]\n*Gold Time: 0:20.000\n*Silver Time: 0:21.000\n*Bronze Time: 0:22.000\n`;
}
