import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { catalogueEntry } from './fixtures.ts';
import { ApiStub, renderApp, setViewportWidth, signedIn } from './support.tsx';

const ENTRIES = [
  catalogueEntry({ id: 'licence-b-1', code: 'B-1', name: 'Start & Stop', track: 'Tsukuba Circuit', collection: 'National B' }),
  catalogueEntry({ id: 'licence-b-2', code: 'B-2', name: 'Braking', track: 'Fuji Speedway', collection: 'National B' }),
  catalogueEntry({ id: 'ce-tsukuba-1', family: 'Circuit Experience', collection: 'Japan', name: 'Tsukuba Circuit Sector 1', track: 'Tsukuba Circuit' }),
  catalogueEntry({ id: 'brand-yangwang-racing-lines', family: 'Brand Experience', collection: 'Yangwang', name: 'Racing Lines', exerciseId: 'ex-1', status: 'ready' })
];

function catalogueApi(): ApiStub {
  return signedIn(new ApiStub())
    .on('GET /api/catalogue', ENTRIES)
    .on('GET /api/catalogue/circuits', [])
    .on('GET /api/exercises', [])
    .install();
}

function listed(): string[] {
  return within(screen.getByRole('table', { name: 'Exercises' }))
    .queryAllByRole('row')
    .slice(1)
    .map(row => row.getAttribute('data-entry') ?? '');
}

describe('catalogue', () => {
  it('catalogue_filters_and_search_combine', async () => {
    setViewportWidth(1280);
    catalogueApi();
    renderApp({ path: '/catalogue' });
    const user = userEvent.setup();
    await screen.findByRole('table', { name: 'Exercises' });
    expect(listed()).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: /^Licence/ }));
    expect(listed()).toEqual(['licence-b-1', 'licence-b-2']);
    await user.type(screen.getByRole('searchbox', { name: 'Search the catalogue' }), 'tsukuba');
    expect(listed()).toEqual(['licence-b-1']);
    await user.click(screen.getByRole('button', { name: /^All/ }));
    expect(listed()).toEqual(['licence-b-1', 'ce-tsukuba-1']);
  });

  it('empty_result_explains_how_to_clear', async () => {
    setViewportWidth(1280);
    catalogueApi();
    renderApp({ path: '/catalogue' });
    const user = userEvent.setup();
    await user.type(await screen.findByRole('searchbox', { name: 'Search the catalogue' }), 'no such exercise');
    expect(screen.getByText(/Nothing matches these filters/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(listed()).toHaveLength(4);
    expect(screen.getByRole('searchbox', { name: 'Search the catalogue' })).toHaveValue('');
  });

  it('entry_shows_no_support_state', async () => {
    setViewportWidth(1280);
    catalogueApi();
    renderApp({ path: '/catalogue' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /B-2 Braking/ }));
    const detail = screen.getByRole('region', { name: 'Selected exercise' });
    expect(within(detail).getByRole('button', { name: 'Add this exercise' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Racing Lines/ }));
    expect(within(detail).getByRole('button', { name: 'Open this exercise' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Support' })).not.toBeInTheDocument();
    expect(screen.queryByText(/checked/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
  });
});
