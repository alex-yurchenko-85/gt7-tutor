import type { CatalogueListEntry, Exercise } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { useResource } from '../../app/resource.ts';
import { t } from '../../app/i18n.ts';

export const CIRCUIT_EXPERIENCE = 'Circuit Experience';

export type ExerciseNaming = Pick<Exercise, 'catalogueId' | 'family' | 'name' | 'collection' | 'code'>;

export type ExerciseTitle = { title: string; detail: string | null };

export type WhereDetails = {
  family?: string | null | undefined;
  detail: string | null;
  track?: string | null | undefined;
};

export function placeParts(family: string | null | undefined, collection: string | null | undefined, code: string | null | undefined): string[] {
  return family === CIRCUIT_EXPERIENCE ? [] : [collection, code].filter((part): part is string => Boolean(part));
}

export function exerciseTitle(exercise: ExerciseNaming): ExerciseTitle {
  const place = placeParts(exercise.family, exercise.collection, exercise.code).join(', ');
  if (exercise.code && place) return { title: place, detail: exercise.name };
  return { title: exercise.name, detail: place || (exercise.catalogueId === null ? t('exercises.own-collection') : null) };
}

export function whereText(details: WhereDetails): string {
  return [details.family, details.detail, details.track].filter(Boolean).join(' · ');
}

export function useExerciseWhere(exercise: Exercise): string {
  const catalogue = useResource(
    (): Promise<CatalogueListEntry[]> => (exercise.catalogueId ? api.catalogue() : Promise.resolve([])),
    [exercise.id, exercise.catalogueId]
  );
  const entry = catalogue.data?.find(item => item.id === exercise.catalogueId) ?? null;
  return whereText({ family: exercise.family, detail: exerciseTitle(exercise).detail, track: entry?.track });
}
