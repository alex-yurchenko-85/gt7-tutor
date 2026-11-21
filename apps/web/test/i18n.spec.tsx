import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { pseudoPack, translate } from '@gt7/contracts';
import { formatDateTime, groupedMetres } from '../src/app/format.ts';
import { currentLanguage, startLanguage, t } from '../src/app/i18n.ts';
import { ApiStub, renderApp, signedIn } from './support.tsx';

function storageWith(values: Record<string, string>): Storage {
  return { getItem: (key: string) => values[key] ?? null } as Storage;
}

const throwingStorage = {
  getItem: () => {
    throw new DOMException('denied', 'SecurityError');
  }
} as unknown as Storage;

describe('language', () => {
  afterEach(() => startLanguage('', null));

  it('uses_english_when_the_pack_or_the_storage_is_missing', () => {
    startLanguage('?lang=ru', null);
    expect(currentLanguage()).toBe('en');
    expect(t('common.cancel')).toBe('Cancel');
    startLanguage('', throwingStorage);
    expect(currentLanguage()).toBe('en');
    startLanguage('', storageWith({ 'gt7.language': 'ru' }));
    expect(currentLanguage()).toBe('en');
    startLanguage('', null);
    expect(currentLanguage()).toBe('en');
  });

  it('takes_the_address_before_the_storage', () => {
    startLanguage('', storageWith({ 'gt7.language': 'xx' }));
    expect(currentLanguage()).toBe('xx');
    startLanguage('?lang=en', storageWith({ 'gt7.language': 'xx' }));
    expect(currentLanguage()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    startLanguage('?lang=xx', null);
    expect(document.documentElement.lang).toBe('xx');
  });

  it('uses_the_pseudo_language_from_the_address', async () => {
    startLanguage('?lang=xx', null);
    signedIn(new ApiStub()).on('GET /api/exercises', []).on('GET /api/catalogue', []).install();
    renderApp({ path: '/exercises?lang=xx' });
    const pseudo = translate(pseudoPack(), 'app.nav.exercises');
    expect(pseudo).not.toBe('Exercises');
    expect((await screen.findAllByRole('link', { name: pseudo })).length).toBeGreaterThan(0);
  });

  it('formats_dates_in_the_language_of_the_pack', () => {
    startLanguage('', null);
    expect(formatDateTime('2026-11-21T18:29:00')).toBe('21 Nov 2026, 18:29');
    expect(groupedMetres(12345.4)).toBe('12,345 m');
    startLanguage('?lang=xx', null);
    expect(formatDateTime('2026-11-21T18:29:00')).toBe('21 Nov 2026, 18:29');
  });
});
