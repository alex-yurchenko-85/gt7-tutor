import type { CatalogueListEntry, Exercise, Progress } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { useResource } from '../../app/resource.ts';

export type WhereDetails = {
  family?: string | null | undefined;
  collection: string | null;
  code?: string | null | undefined;
  track?: string | null | undefined;
  car?: string | null | undefined;
};

export function whereText(details: WhereDetails): string {
  const collection = [details.collection, details.code].filter(Boolean).join(', ');
  return [details.family, collection, details.track, details.car].filter(Boolean).join(' · ');
}

type Sources = { progress: Progress | null; catalogue: CatalogueListEntry[] };

export function useExerciseWhere(exercise: Exercise): string {
  const sources = useResource(
    (): Promise<Sources> =>
      exercise.catalogueId
        ? Promise.all([api.progress(), api.catalogue()]).then(([progress, catalogue]) => ({ progress, catalogue }))
        : Promise.resolve({ progress: null, catalogue: [] }),
    [exercise.id, exercise.catalogueId]
  );
  const entry = sources.data?.catalogue.find(item => item.id === exercise.catalogueId) ?? null;
  const collection = sources.data?.progress?.exercises.find(item => item.id === exercise.id)?.collection ?? null;
  return whereText({ family: exercise.family, collection, code: entry?.code, track: entry?.track });
}
