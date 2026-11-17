import { catalogueSchema, type Catalogue } from '@gt7/contracts';

export class CatalogueValidationError extends Error {
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`Invalid catalogue at ${path || '(root)'}: ${reason}`);
    this.path = path;
  }
}

export function validateCatalogue(candidate: unknown): Catalogue {
  const result = catalogueSchema.safeParse(candidate);
  if (result.success) return result.data;
  const issue = result.error.issues[0]!;
  throw new CatalogueValidationError(issue.path.join('.'), issue.message);
}
