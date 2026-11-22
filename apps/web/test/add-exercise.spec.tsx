import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { catalogueEntry, exercise, EXERCISE_ID } from './fixtures.ts';
import { ApiStub, renderApp, setViewportWidth, signedIn, USER, el, findEl, iconButton } from './support.tsx';

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
  catalogueEntry({ id: 'brand-yangwang-racing-lines', family: 'Brand Central', collection: 'Yangwang', code: 'EXP-1', name: 'Racing Lines', exerciseId: EXERCISE_ID, status: 'ready' })
];

function catalogueApi(): ApiStub {
  return signedIn(new ApiStub())
    .on('GET /api/catalogue', ENTRIES)
    .on('GET /api/exercises', [])
    .install();
}

function listed(): string[] {
  return within(el('.catalogue-list table'))
    .queryAllByRole('row')
    .slice(1)
    .map(row => row.getAttribute('data-entry') ?? '');
}

function row(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-entry="${id}"]`)!;
}

describe('add exercise', () => {
  it('add_exercise_has_breadcrumb_and_sources', async () => {
    catalogueApi();
    renderApp({ path: '/exercises/add' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Add an exercise' })).toBeInTheDocument();
    const breadcrumb = el('nav.breadcrumb');
    expect(breadcrumb).toHaveTextContent('Exercises / Add');
    expect(within(breadcrumb).getByRole('link', { name: 'Exercises' })).toHaveAttribute('href', '/');
    expect(screen.getByText(/A catalogue entry does not mean that GT7 Tutor supports the exercise\./)).toBeInTheDocument();
  });

  it('catalogue_filters_and_search_combine', async () => {
    catalogueApi();
    renderApp({ path: '/exercises/add' });
    const user = userEvent.setup();
    await findEl('.catalogue-list table');
    expect(listed()).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: /^Licence/ }));
    expect(listed()).toEqual(['licence-b-1', 'licence-b-3']);
    await user.type(el('input[type="search"]'), 'tsukuba');
    expect(listed()).toEqual(['licence-b-1']);
    await user.click(screen.getByRole('button', { name: /^All/ }));
    expect(listed()).toEqual(['licence-b-1', 'ce-tsukuba-1']);
  });

  it('an_empty_search_says_to_clear_the_filters', async () => {
    catalogueApi();
    renderApp({ path: '/exercises/add' });
    await findEl('.catalogue-list table');
    await userEvent.setup().type(el('input[type="search"]'), 'zzzz');
    expect(screen.getByText('Check the spelling, or clear the filters.')).toBeInTheDocument();
  });

  it('search_filters_by_code', async () => {
    catalogueApi();
    renderApp({ path: '/exercises/add' });
    await findEl('.catalogue-list table');
    await userEvent.setup().type(el('input[type="search"]'), 'b-3');
    expect(listed()).toEqual(['licence-b-3']);
    expect(row('licence-b-3')).toHaveTextContent('Cornering Basics 1');
  });

  it('rows_show_track_car_and_targets', async () => {
    catalogueApi();
    renderApp({ path: '/exercises/add' });
    await findEl('.catalogue-list table');
    const first = row('licence-b-1');
    expect(first).toHaveTextContent('Licence · National B B-1');
    expect(first).toHaveTextContent("Mazda Demio XD Touring '15");
    expect(first).toHaveTextContent('Gold 20.800 · Silver 21.400 · Bronze 22.800');
    expect(row('ce-tsukuba-1')).toHaveTextContent('Not listed');
  });

  it('added_exercise_becomes_the_current_one', async () => {
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
    await findEl('.catalogue-list table');
    expect(window.localStorage.getItem('gt7.currentExercise.user-1')).toBeNull();
    await userEvent.setup().click(within(row('licence-b-3')).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(window.localStorage.getItem('gt7.currentExercise.user-1')).toBe(added.id));
  });

  it('add_navigates_to_exercise_page', async () => {
    const api = catalogueApi()
      .on('POST /api/exercises', { status: 201, body: exercise({ id: 'e0000000-0000-4000-8000-000000000009', name: 'Cornering Basics 1' }) })
      .on('GET /api/exercises/e0000000-0000-4000-8000-000000000009', exercise({ id: 'e0000000-0000-4000-8000-000000000009', name: 'Cornering Basics 1', activeReferenceId: null, step: 1 }));
    renderApp({ path: '/exercises/add' });
    await findEl('.catalogue-list table');
    await userEvent.setup().click(within(row('licence-b-3')).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(window.location.pathname).toBe('/exercises/e0000000-0000-4000-8000-000000000009'));
    expect(api.calls.find(call => call.method === 'POST' && call.path === '/api/exercises')?.body).toEqual({ catalogueId: 'licence-b-3' });
    expect(window.localStorage.getItem(`gt7.currentExercise.${USER.id}`)).toBe('e0000000-0000-4000-8000-000000000009');
  });

  it('added_entry_links_to_its_page', async () => {
    catalogueApi();
    renderApp({ path: '/exercises/add' });
    await findEl('.catalogue-list table');
    const open = within(row('brand-yangwang-racing-lines')).getByRole('link', { name: 'Added · open' });
    expect(open).toHaveAttribute('href', `/exercises/${EXERCISE_ID}`);
    expect(within(row('brand-yangwang-racing-lines')).queryByRole('button')).toBeNull();
    expect(screen.queryByText(/checked/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
  });

  it('empty_search_shows_hint', async () => {
    catalogueApi();
    renderApp({ path: '/exercises/add' });
    const user = userEvent.setup();
    await user.type(await findEl('input[type="search"]'), 'no such exercise');
    expect(screen.getByText('No exercise matches.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(listed()).toHaveLength(4);
    expect(el('input[type="search"]')).toHaveValue('');
  });

  it('own_exercise_form_stays', async () => {
    setViewportWidth(390);
    catalogueApi();
    renderApp({ path: '/exercises/add' });
    expect(await findEl('form.own-exercise')).toBeInTheDocument();
  });

  it('own_exercise_is_created_with_an_icon_button', async () => {
    catalogueApi();
    renderApp({ path: '/exercises/add' });
    const form = await findEl('form.own-exercise');
    const create = iconButton('Create exercise', form);
    expect(create.textContent).toBe('');
    expect(create.querySelector('[data-icon="check"]')).not.toBeNull();
  });
});
