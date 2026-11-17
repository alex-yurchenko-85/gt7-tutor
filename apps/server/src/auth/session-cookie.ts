import type { CookieOptions, Request } from 'express';

export const SESSION_COOKIE = 'gt7_session';
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export const sessionCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: false,
  path: '/'
};

function decodeCookieValue(value: string): string | null {
  if (value === '') return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeCookieValue(part.slice(separator + 1).trim());
  }
  return null;
}

export function sessionTokenOf(request: Pick<Request, 'headers'>): string | null {
  return readCookie(request.headers.cookie, SESSION_COOKIE);
}
