import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { catalogueEntry, exercise } from './fixtures.ts';
import { ApiStub, renderApp, setViewportWidth, signedIn, USER } from './support.tsx';

const ENTRIES = [
  catalogueEntry({
    id: 'licence-b-1',
    code: 'B-1',
    name: 'Starting & Stopping 1',
    track: 'Tsukuba Circuit',
    car: "Mazda Demio XD Touring '15",
    collection: 'National B',
    targets: { goldMs: 20800, silverMs: 21400, bronzeMs: 22800 }
  }),
  catalogueEntry({ id: 'licence-b-3', code: 'B-3', name: 'Cornering Basics 1', track: 'Alsace - Village', collection: 'National B' }),
  catalogueEntry({ id: 'ce-tsukuba-1', family: 'Circuit Experience', collection: 'Japan', name: 'Tsukuba Circuit Sector 1', track: 'Tsukuba Circuit' }),
  catalogueEntry({ id: 'brand-yangwang-racing-lines', family: 'Brand Central', collection: 'Yangwang', code: 'EXP-1', name: 'Racing Lines', exerciseId: 'e0000000-0000-4000-8000-000000000001', status: 'ready' })
];

function catalogueApi(): ApiStub {
  return signedIn(new ApiStub())
    .on('GET /api/catalogue', ENTRIES)
    .on('GET /api/exercises', [])
    .install();
}

function listed(): string[] {
  return within(screen.getByRole('table', { name: 'Catalogue exercises' }))
    .queryAllByRole('row')
    .slice(1)
    .map(row => row.getAttribute('data-entry') ?? '');
}

function row(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-entry="${id}"]`)!;
}

describe('add exercise', () => {
  it('add_exercise_has_breadcrumb_and_sources', async () => {
    setViewportWidth(1440);
    catalogueApi();
    renderApp({ path: '/exercises/add' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Add an exercise' })).toBeInTheDocument();
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(breadcrumb).toHaveTextContent('Exercises / Add');
    expect(within(breadcrumb).getByRole('link', { name: 'Exercises' })).toHaveAttribute('href', '/');
    expect(screen.getByText(/A catalogue entry does not mean that GT7 Tutor supports the exercise\./)).toBeInTheDocument();
  });

  it('catalogue_filters_and_search_combine', async () => {
    setViewportWidth(1280);
    catalogueApi();
    renderApp({ path: '/exercises/add' });
    const user = userEvent.setup();
    await screen.findByRole('table', { name: 'Catalogue exercises' });
    expect(listed()).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: /^Licence/ }));
    expect(listed()).toEqual(['licence-b-1', 'licence-b-3']);
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'tsukuba');
    expect(listed()).toEqual(['licence-b-1']);
    await user.click(screen.getByRole('button', { name: /^All/ }));
    expect(listed()).toEqual(['licence-b-1', 'ce-tsukuba-1']);
  });

  it('search_filters_by_code', async () => {
    setViewportWidth(1440);
    catalogueApi();
    renderApp({ path: '/exercises/add' });
    await screen.findByRole('table', { name: 'Catalogue exercises' });
    await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Search' }), 'b-3');
    expect(listed()).toEqual(['licence-b-3']);
    expect(row('licence-b-3')).toHaveTextContent('Cornering Basics 1');
  });

  it('rows_show_track_car_and_targets', async () => {
    setViewportWidth(1440);
    catalogueApi();
    renderApp({ path: '/exercises/add' });
    await screen.findByRole('table', { name: 'Catalogue exercises' });
    const first = row('licence-b-1');
    expect(first).toHaveTextContent('Licence · National B B-1');
    expect(first).toHaveTextContent("Mazda Demio XD Touring '15");
    expect(first).toHaveTextContent('Gold 20.80 · Silver 21.40 · Bronze 22.80');
    expect(row('ce-tsukuba-1')).toHaveTextContent('Not listed');
  });

  it('drive_button_shows_an_added_exercise', async () => {
    setViewportWidth(1440);
    const added = exercise({ id: 'e0000000-0000-4000-8000-000000000009', name: 'Cornering Basics 1', activeReferenceId: null, step: 1 });
    let created = false;
    catalogueApi()
      .on('GET /api/exercises', () => (created ? [added] : []))
      .on('POST /api/exercises', () => {
        created = true;
        return { status: 201, body: added };
      })
      .on('GET /api/exercises/e0000000-0000-4000-8000-000000000009', added);
    renderApp({ path: '/exercises/add' });
    await screen.findByRole('table', { name: 'Catalogue exercises' });
    expect(screen.queryByRole('link', { name: /^Drive/ })).toBeNull();
    await userEvent.setup().click(within(row('licence-b-3')).getByRole('button', { name: 'Add Cornering Basics 1' }));
    expect(await screen.findByRole('link', { name: /^Drive/ })).toHaveTextContent('Cornering Basics 1');
  });

  it('add_navigates_to_exercise_page', async () => {
    setViewportWidth(1440);
    const api = catalogueApi()
      .on('POST /api/exercises', { status: 201, body: exercise({ id: 'e0000000-0000-4000-8000-000000000009', name: 'Cornering Basics 1' }) })
      .on('GET /api/exercises/e0000000-0000-4000-8000-000000000009', exercise({ id: 'e0000000-0000-4000-8000-000000000009', name: 'Cornering Basics 1', activeReferenceId: null, step: 1 }));
    renderApp({ path: '/exercises/add' });
    await screen.findByRole('table', { name: 'Catalogue exercises' });
    await userEvent.setup().click(within(row('licence-b-3')).getByRole('button', { name: 'Add Cornering Basics 1' }));
    await waitFor(() => expect(window.location.pathname).toBe('/exercises/e0000000-0000-4000-8000-000000000009'));
    expect(api.calls.find(call => call.method === 'POST' && call.path === '/api/exercises')?.body).toEqual({ catalogueId: 'licence-b-3' });
    expect(window.localStorage.getItem(`gt7.currentExercise.${USER.id}`)).toBe('e0000000-0000-4000-8000-000000000009');
  });

  it('added_entry_links_to_its_page', async () => {
    setViewportWidth(1440);
    catalogueApi();
    renderApp({ path: '/exercises/add' });
    await screen.findByRole('table', { name: 'Catalogue exercises' });
    const open = within(row('brand-yangwang-racing-lines')).getByRole('link', { name: 'Added · open Racing Lines' });
    expect(open).toHaveAttribute('href', '/exercises/e0000000-0000-4000-8000-000000000001');
    expect(within(row('brand-yangwang-racing-lines')).queryByRole('button')).toBeNull();
    expect(screen.queryByText(/checked/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
  });

  it('empty_search_shows_hint', async () => {
    setViewportWidth(1280);
    catalogueApi();
    renderApp({ path: '/exercises/add' });
    const user = userEvent.setup();
    await user.type(await screen.findByRole('searchbox', { name: 'Search' }), 'no such exercise');
    expect(screen.getByText('No exercise matches.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(listed()).toHaveLength(4);
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('');
  });

  it('own_exercise_form_stays', async () => {
    setViewportWidth(390);
    catalogueApi();
    renderApp({ path: '/exercises/add' });
    expect(await screen.findByRole('form', { name: 'Your own exercise' })).toBeInTheDocument();
  });

  it('own_exercise_is_created_with_an_icon_button', async () => {
    setViewportWidth(1280);
    catalogueApi();
    renderApp({ path: '/exercises/add' });
    const form = await screen.findByRole('form', { name: 'Your own exercise' });
    const create = within(form).getByRole('button', { name: 'Create exercise' });
    expect(create.textContent).toBe('');
    expect(create.querySelector('[data-icon="check"]')).not.toBeNull();
  });
});
