import { readRaw } from '@gt7/capture';

export async function countRows(path: string): Promise<number> {
  let rows = 0;
  for await (const _row of readRaw(path)) rows++;
  return rows;
}
