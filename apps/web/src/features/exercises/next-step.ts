import type { ExerciseStatusName, ExerciseStep } from '@gt7/contracts';

const NEXT_TITLE: Record<ExerciseStep, string> = {
  1: 'Next: record the reference',
  2: 'Next: drive attempts',
  3: 'Next: review your attempts'
};

export const STATUS_LABEL: Record<ExerciseStatusName, string> = {
  new: 'New',
  ready: 'Ready',
  practising: 'Practising',
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold'
};

const FAMILY_ORDER = ['Licence', 'Circuit Experience', 'Brand Central'];

export function orderedFamilies(families: string[]): string[] {
  const present = new Set(families);
  const extra = [...present].filter(family => !FAMILY_ORDER.includes(family)).sort((a, b) => a.localeCompare(b));
  return [...FAMILY_ORDER.filter(family => present.has(family)), ...extra];
}

export function nextTitle(step: ExerciseStep): string {
  return NEXT_TITLE[step];
}
