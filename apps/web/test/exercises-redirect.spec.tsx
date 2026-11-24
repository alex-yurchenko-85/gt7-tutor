import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { exerciseApi } from './fixtures.ts';
import { renderApp } from './support.tsx';

describe('exercises redirect', () => {
  it('redirects_the_root_and_the_old_add_page_to_exercises', async () => {
    for (const path of ['/', '/exercises/add']) {
      exerciseApi().install();
      const before = window.history.length;
      renderApp({ path });
      await waitFor(() => expect(window.location.pathname).toBe('/exercises'));
      expect(window.history.length).toBe(before);
    }
  });

  it('keeps_the_query_and_the_hash_on_the_redirect', async () => {
    for (const path of ['/?lang=xx#top', '/exercises/add?lang=xx#top']) {
      exerciseApi().install();
      renderApp({ path });
      await waitFor(() => expect(window.location.pathname).toBe('/exercises'));
      expect(window.location.search).toBe('?lang=xx');
      expect(window.location.hash).toBe('#top');
    }
  });
});
