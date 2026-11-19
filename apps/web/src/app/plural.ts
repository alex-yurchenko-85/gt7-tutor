export function counted(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function theirs(count: number): string {
  return count === 1 ? 'its' : 'their';
}
