import { KPH_PER_MPS } from '@gt7/contracts';

export function kph(value: number): number {
  return value / KPH_PER_MPS;
}
