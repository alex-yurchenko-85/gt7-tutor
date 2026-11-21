import { z } from 'zod';

const entryIdPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const medalTargetsSchema = z.object({
  bronzeMs: z.number().int().positive(),
  silverMs: z.number().int().positive(),
  goldMs: z.number().int().positive()
});

export type MedalTargetTimes = z.infer<typeof medalTargetsSchema>;

export const catalogueEntrySchema = z.object({
  id: z.string().regex(entryIdPattern),
  family: z.string().min(1),
  collection: z.string().min(1),
  code: z.string().min(1).nullable(),
  name: z.string().min(1),
  track: z.string().min(1).nullable(),
  circuitId: z.number().int().nonnegative().nullable(),
  car: z.string().min(1).nullable(),
  targets: medalTargetsSchema.nullable(),
  sections: z.number().int().positive().nullable(),
  source: z.string().min(1)
});

export type CatalogueEntry = z.infer<typeof catalogueEntrySchema>;

export const circuitSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().min(1),
  location: z.string().min(1).nullable(),
  country: z.string().min(1).nullable(),
  category: z.string().min(1),
  lengthM: z.number().positive().nullable(),
  corners: z.number().int().nonnegative().nullable(),
  reverse: z.boolean(),
  oval: z.boolean()
});

export type Circuit = z.infer<typeof circuitSchema>;

export const carSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().min(1)
});

export type Car = z.infer<typeof carSchema>;

function uniqueIds(items: { id: string | number }[], context: z.RefinementCtx, path: string): void {
  const seen = new Set<string | number>();
  items.forEach((item, index) => {
    if (seen.has(item.id)) context.addIssue({ code: 'custom', message: `Duplicate id ${item.id}`, path: [path, index, 'id'] });
    seen.add(item.id);
  });
}

export const catalogueSchema = z
  .object({
    schemaVersion: z.literal(1),
    retrieved: z.iso.datetime(),
    gameVersionNote: z.string(),
    circuits: z.array(circuitSchema),
    cars: z.array(carSchema),
    entries: z.array(catalogueEntrySchema).min(1)
  })
  .superRefine((catalogue, context) => {
    uniqueIds(catalogue.circuits, context, 'circuits');
    uniqueIds(catalogue.cars, context, 'cars');
    uniqueIds(catalogue.entries, context, 'entries');
  });

export type Catalogue = z.infer<typeof catalogueSchema>;

export type CatalogueRejection = { lost: number; total: number; family: string };

export type CatalogueDiff = {
  added: CatalogueEntry[];
  removed: CatalogueEntry[];
  changed: { id: string; fields: string[] }[];
  rejected: CatalogueRejection | null;
};

export const exerciseStatusSchema = z.enum(['new', 'ready', 'practising', 'bronze', 'silver', 'gold']);

export type ExerciseStatusName = z.infer<typeof exerciseStatusSchema>;

export type CatalogueListEntry = CatalogueEntry & { exerciseId: string | null; status: ExerciseStatusName | null };

export type CatalogueSource = { name: string; licence: string; url: string };

export type CatalogueInfo = {
  retrieved: string;
  gameVersionNote: string;
  counts: { entries: Record<string, number>; circuits: number; cars: number };
  sources: CatalogueSource[];
  hasPrevious: boolean;
  previousRetrieved: string | null;
};

export type CatalogueCheckResponse = { token: string; diff: CatalogueDiff };

export const catalogueApplySchema = z.object({ token: z.string().min(1).max(200) });

export type CatalogueApplyRequest = z.infer<typeof catalogueApplySchema>;
