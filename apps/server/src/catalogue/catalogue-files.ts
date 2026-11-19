import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateCatalogue } from '@gt7/catalogue';
import type { Catalogue } from '@gt7/contracts';

export type CatalogueOrigin = 'committed' | 'saved';

export type LoadedCatalogue = { catalogue: Catalogue; origin: CatalogueOrigin };

function retrievedTime(catalogue: Catalogue): number {
  return Date.parse(catalogue.retrieved);
}

async function readCatalogue(path: string): Promise<Catalogue> {
  return validateCatalogue(JSON.parse(await readFile(path, 'utf8')));
}

async function writeAtomically(path: string, catalogue: Catalogue): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(catalogue, null, 2)}\n`);
  await rename(temporary, path);
}

export class CatalogueFiles {
  readonly committedPath: string;
  readonly aliasesPath: string;
  readonly savedPath: string;
  readonly previousPath: string;
  private readonly savedDir: string;
  private knownPreviousRetrieved: { value: string | null } | null = null;

  constructor(catalogueDir: string, dataDir: string) {
    this.committedPath = join(catalogueDir, 'catalogue.json');
    this.aliasesPath = join(catalogueDir, 'aliases.json');
    this.savedDir = join(dataDir, 'catalogue');
    this.savedPath = join(this.savedDir, 'catalogue.json');
    this.previousPath = join(this.savedDir, 'catalogue.previous.json');
  }

  async active(onSavedFileProblem: (reason: string) => void): Promise<LoadedCatalogue> {
    const committed = await readCatalogue(this.committedPath);
    if (!existsSync(this.savedPath)) return { catalogue: committed, origin: 'committed' };
    try {
      const saved = await readCatalogue(this.savedPath);
      return retrievedTime(saved) >= retrievedTime(committed) ? { catalogue: saved, origin: 'saved' } : { catalogue: committed, origin: 'committed' };
    } catch (error) {
      onSavedFileProblem(error instanceof Error ? error.message : String(error));
      return { catalogue: committed, origin: 'committed' };
    }
  }

  async aliases(): Promise<Record<string, number>> {
    if (!existsSync(this.aliasesPath)) return {};
    return JSON.parse(await readFile(this.aliasesPath, 'utf8')) as Record<string, number>;
  }

  hasPrevious(): boolean {
    return existsSync(this.previousPath);
  }

  async previousRetrieved(): Promise<string | null> {
    this.knownPreviousRetrieved ??= { value: this.hasPrevious() ? (await this.previous()).retrieved : null };
    return this.knownPreviousRetrieved.value;
  }

  async save(next: Catalogue, current: Catalogue): Promise<void> {
    await mkdir(this.savedDir, { recursive: true });
    await writeAtomically(this.previousPath, current);
    this.knownPreviousRetrieved = { value: current.retrieved };
    await writeAtomically(this.savedPath, next);
  }

  async previous(): Promise<Catalogue> {
    return readCatalogue(this.previousPath);
  }

  async restore(previous: Catalogue): Promise<void> {
    await writeAtomically(this.savedPath, previous);
    await rm(this.previousPath);
    this.knownPreviousRetrieved = { value: null };
  }
}
