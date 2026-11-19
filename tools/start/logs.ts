export const LOG_DIR = 'data/logs';
export const KEEP_LOGS = 10;

const LOG_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(-demo)?\.log$/;
const RELEASE_HEADING = /^#{1,2} \[(\d+\.\d+\.\d+)\]/m;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function logFileName(start: Date, demo: boolean): string {
  const date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  const time = `${pad(start.getHours())}-${pad(start.getMinutes())}-${pad(start.getSeconds())}`;
  return `${date}_${time}${demo ? '-demo' : ''}.log`;
}

export function logsToRemove(names: string[], keep: number): string[] {
  const logs = names.filter((name) => LOG_PATTERN.test(name)).sort();
  return logs.slice(0, Math.max(0, logs.length - keep));
}

export function changelogVersion(text: string | null): string {
  return text?.match(RELEASE_HEADING)?.[1] ?? 'unknown';
}

export function logHeader(input: { start: Date; version: string; buildHash: string; node: string; platform: string }): string {
  return `GT7 Tutor ${input.version} · build ${input.buildHash.slice(0, 12)} · Node ${input.node} · ${input.platform} · started ${input.start.toISOString()}`;
}

export function lastLines(text: string, count: number): string[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.slice(Math.max(0, lines.length - count));
}
