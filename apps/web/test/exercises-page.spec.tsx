import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CatalogueListEntry, Exercise } from '@gt7/contracts';
import { trackTargetSave } from '../src/features/exercise/target-save.ts';
import { catalogueEntry, exercise, exerciseApi, rememberExercise, REFERENCE_ID } from './fixtures.ts';
import { attemptSummary } from './review-fixtures.ts';
import { ApiStub, liveState, renderApp, setViewportWidth, openLive, findSection, maybeSection, sectionOf, dialogOf, el, els, maybeEl, elWith, findEl, iconButton, USER } from './support.tsx';

const ID = (n: number) => `e0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

const CATALOGUE: CatalogueListEntry[] = [
  catalogueEntry({ id: 'licence-b-5', code: 'B-5', name: 'Cornering Basics 3', track: 'Tsukuba Circuit', car: "Autobianchi A112 Abarth '85", targetMs: 13100, exerciseId: ID(11), status: 'target-reached' }),
  catalogueEntry({ id: 'licence-b-7', code: 'B-7', name: 'Cornering Basics 5', track: 'Trial Mountain Circuit', car: "Toyota GR86 RZ '21", targetMs: 17800, exerciseId: ID(12), status: 'practising' }),
  catalogueEntry({ id: 'licence-b-9', code: 'B-9', name: 'Cornering Basics 7', track: 'Dragon Trail - Seaside', car: "Honda Civic Type R Limited Edition (FK8) '20", targetMs: 17800, exerciseId: ID(13), status: 'new' }),
  catalogueEntry({ id: 'licence-b-10', code: 'B-10', name: 'Driving Basics', track: 'Tsukuba Circuit', car: "Renault Sport Clio R.S. 220 EDC Trophy '16", targetMs: 25300 }),
  catalogueEntry({ id: 'licence-a-1', code: 'A-1', name: 'Racing Line: Beginner 1', track: 'Tsukuba Circuit', collection: 'National A' }),
  catalogueEntry({
    id: 'ce-interlagos-s2',
    family: 'Circuit Experience',
    collection: 'South America',
    code: 'Sector 2',
    name: 'Autódromo de Interlagos · Sector 2',
    track: 'Autódromo de Interlagos',
    car: "Nissan GT-R NISMO GT3 '13",
    targetMs: 33000,
    exerciseId: ID(14),
    status: 'practising'
  }),
  catalogueEntry({ id: 'ce-tsukuba-s1', family: 'Circuit Experience', collection: 'Asia/Oceania', code: 'Sector 1', name: 'Tsukuba Circuit · Sector 1', track: 'Tsukuba Circuit' }),
  catalogueEntry({ id: 'brand-yangwang-racing-lines', family: 'Brand Central', collection: 'Yangwang', code: 'EXP-1', name: 'Racing Lines', track: 'SUGO' })
];

const B5 = exercise({
  id: ID(11),
  catalogueId: 'licence-b-5',
  family: 'Licence',
  collection: 'National B',
  code: 'B-5',
  name: 'Cornering Basics 3',
  status: 'target-reached',
  bestMs: 13024,
  targetMs: 13100,
  targetGapMs: null,
  attemptCount: 4,
  lastAttemptAt: '2026-11-20T10:00:00.000Z'
});

const B7 = exercise({
  id: ID(12),
  catalogueId: 'licence-b-7',
  family: 'Licence',
  collection: 'National B',
  code: 'B-7',
  name: 'Cornering Basics 5',
  status: 'practising',
  bestMs: 17867,
  targetMs: 17800,
  targetGapMs: 67,
  attemptCount: 6,
  referenceCount: 2,
  lastAttemptAt: '2026-11-23T10:00:00.000Z'
});

const B9 = exercise({
  id: ID(13),
  catalogueId: 'licence-b-9',
  family: 'Licence',
  collection: 'National B',
  code: 'B-9',
  name: 'Cornering Basics 7',
  status: 'new',
  activeReferenceId: null,
  referenceCount: 0,
  targetMs: 17800
});

const S2 = exercise({
  id: ID(14),
  catalogueId: 'ce-interlagos-s2',
  family: 'Circuit Experience',
  collection: 'South America',
  code: 'Sector 2',
  name: 'Autódromo de Interlagos · Sector 2',
  status: 'practising',
  bestMs: 33402,
  targetMs: 33000,
  targetGapMs: 402,
  attemptCount: 2,
  lastAttemptAt: '2026-11-21T10:00:00.000Z'
});

const OWN = exercise({ id: ID(15), catalogueId: null, family: 'Time Trial', collection: null, code: null, name: 'Fuji short', status: 'practising' });

const ALL = [B5, B7, B9, S2, OWN];

function pageApi(exercises: Exercise[] = ALL, ps5Ip: string | null = '192.0.2.10'): ApiStub {
  return exerciseApi(B7)
    .on('GET /api/exercises', exercises)
    .on('GET /api/catalogue', CATALOGUE)
    .on('GET /api/catalogue/info', {
      retrieved: '',
      gameVersionNote: '',
      counts: { entries: {}, circuits: 0, cars: 0 },
      sources: [{ name: 'ddm999/gt7info', licence: 'MIT-0', url: '' }],
      hasPrevious: false,
      previousRetrieved: null
    })
    .on('GET /api/settings', { ps5Ip, gameVersion: '1.65' })
    .install();
}

function card(): HTMLElement {
  return el('section.continue');
}

function inProgress(): HTMLElement {
  return sectionOf(/^In progress/);
}

function rowNames(root: HTMLElement): string[] {
  return els('.page-row-name b', root).map(node => node.textContent ?? '');
}

function groupHeader(title: string): HTMLElement {
  const found = els('.group-head').find(head => el('b', head).textContent === title);
  if (!found) throw new Error(`No group ${title}`);
  return found;
}

function group(title: string): HTMLElement {
  return groupHeader(title).closest<HTMLElement>('.catalogue-group')!;
}

function groupTitles(): string[] {
  return els('.catalogue-group .group-head b').map(node => node.textContent ?? '');
}

function catalogueRow(entryId: string): HTMLElement {
  return el(`[data-entry="${entryId}"]`);
}

function rowLink(entryId: string): HTMLElement {
  return el('.page-row', catalogueRow(entryId));
}

async function openGroup(title: string): Promise<HTMLElement> {
  await findEl('.catalogue-group');
  await userEvent.setup().click(groupHeader(title));
  return group(title);
}

describe('exercises page', () => {
  it('reads_the_exercises_after_a_pending_target_save', async () => {
    let finish: (value: unknown) => void = () => undefined;
    void trackTargetSave(new Promise(resolve => (finish = resolve)));
    const api = pageApi();
    renderApp({ path: '/exercises' });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(api.calls.some(call => call.method === 'GET' && call.path === '/api/exercises')).toBe(false);
    finish(undefined);
    expect(await findEl('section.continue')).toHaveTextContent('National B, B-7');
  });

  it('shows_continue_for_the_exercise_of_the_last_attempt', async () => {
    rememberExercise(B5.id);
    pageApi();
    renderApp({ path: '/exercises' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Exercises' })).toBeInTheDocument();
    await findEl('section.continue');
    expect(within(card()).getByRole('link', { name: 'National B, B-7' })).toHaveAttribute('href', `/exercises/${B7.id}`);
    expect(el('.continue-kicker', card()).textContent).toBe('Continue · Licence · Cornering Basics 5 · Trial Mountain Circuit');
    expect(card()).toHaveTextContent('0:17.867your best time');
    expect(card()).toHaveTextContent('0.07 sto the target, 0:17.800');
    const drive = within(card()).getByRole('button', { name: 'Drive' });
    expect(drive.querySelector('[data-icon="drive"]')).not.toBeNull();
    expect(within(card()).getByRole('link', { name: 'Attempts' })).toHaveAttribute('href', `/exercises/${B7.id}/attempts`);
    expect(screen.queryByText(/Select a test or a sector/)).toBeNull();
  });

  it('continue_shows_your_focus_above_drive', async () => {
    const focus = { turn: 1, part: 'approach' as const, cause: 'brake-early' as const, clip: 'focus-approach-brake-early-1' };
    pageApi().on(`GET /api/exercises/${B7.id}/attempts`, { bestMs: 17867, days: [{ date: '2026-11-23', bestMs: 17867, attempts: [attemptSummary({ id: 'a7', exerciseId: B7.id, number: 6, referenceId: REFERENCE_ID, focus })] }] });
    for (const width of [1440, 390]) {
      setViewportWidth(width);
      const view = renderApp({ path: '/exercises' });
      const line = await findEl('section.continue .focus-line');
      expect(line).toHaveTextContent('Your focusTurn one. Braking too early before the turn.');
      view.unmount();
    }
  });

  it('continue_without_a_focus_has_no_focus_line', async () => {
    const api = pageApi();
    renderApp({ path: '/exercises' });
    await findEl('section.continue');
    await waitFor(() => expect(api.called(`GET /api/exercises/${B7.id}/attempts`)).toBe(true));
    await act(async () => undefined);
    expect(maybeEl('.focus-line')).toBeNull();
  });

  it('continue_keeps_the_live_exercise_first', async () => {
    pageApi();
    const view = renderApp({ path: '/exercises' });
    await findEl('section.continue');
    await openLive(view.sockets, liveState({ mode: 'finished', exerciseId: S2.id, connection: 'connected' }));
    await waitFor(() => expect(card()).toHaveTextContent('Sector 2'));
  });

  it('a_continue_exercise_without_a_reference_shows_only_record_the_reference', async () => {
    rememberExercise(B9.id);
    pageApi([B9]);
    renderApp({ path: '/exercises' });
    await findEl('section.continue');
    expect(within(card()).getByRole('link', { name: 'National B, B-9' })).toBeInTheDocument();
    expect(within(card()).getByRole('link', { name: 'Record the reference' })).toHaveAttribute('href', `/exercises/${B9.id}/record`);
    expect(within(card()).queryByRole('link', { name: 'Attempts' })).toBeNull();
    expect(within(card()).queryByRole('button', { name: 'Drive' })).toBeNull();
    expect(maybeEl('.continue-times', card())).toBeNull();
  });

  it('continue_has_no_gap_without_a_target', async () => {
    pageApi([exercise({ ...B7, targetMs: null, targetGapMs: null })]);
    renderApp({ path: '/exercises' });
    await findEl('section.continue');
    expect(card()).toHaveTextContent('your best time');
    expect(card()).not.toHaveTextContent('to the target');
  });

  it('continue_on_a_phone_shows_the_best_time_and_the_gap', async () => {
    setViewportWidth(390);
    pageApi();
    renderApp({ path: '/exercises' });
    await findEl('section.continue');
    expect(el('.continue-kicker', card()).textContent).toBe('Continue');
    expect(card()).toHaveTextContent('best 0:17.867 · 0.07 s to the target');
    expect(within(card()).getByRole('button', { name: 'Drive' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('continue_drive_arms_and_opens_the_stage', async () => {
    const api = pageApi().on('POST /api/training/arm', { status: 201, body: { captureId: 'cap-9', exerciseId: B7.id, referenceId: REFERENCE_ID } });
    renderApp({ path: '/exercises' });
    await findEl('section.continue');
    await userEvent.setup().click(within(card()).getByRole('button', { name: 'Drive' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/exercises/${B7.id}/drive`));
    expect(api.calls.find(call => call.path === '/api/training/arm')?.body).toEqual({ exerciseId: B7.id });
  });

  it('lists_in_progress_with_the_gap_to_the_target', async () => {
    pageApi();
    renderApp({ path: '/exercises' });
    const section = await findSection(/^In progress/);
    expect(el('h2', section).textContent).toBe('In progress 3');
    expect(rowNames(section)).toEqual(['National B, B-7', 'Sector 2', 'Fuji short']);
    const b7 = elWith('.page-row', 'National B, B-7', section);
    expect(b7.tagName).toBe('A');
    expect(b7).toHaveAttribute('href', `/exercises/${B7.id}`);
    expect(b7).toHaveClass('current');
    expect(b7).toHaveTextContent('Licence · Cornering Basics 5');
    expect(b7).toHaveTextContent("Trial Mountain Circuit");
    expect(b7).toHaveTextContent("Toyota GR86 RZ '21");
    expect(b7).toHaveTextContent('0:17.867');
    expect(b7).toHaveTextContent('0.07 s to the target');
    expect(elWith('.page-row', 'Sector 2', section)).not.toHaveClass('current');
    expect(el('.page-row-name span', elWith('.page-row', 'Sector 2', section)).textContent).toBe('Circuit Experience');
  });

  it('in_progress_on_a_phone_shows_the_short_gap_and_the_track_of_a_sector', async () => {
    setViewportWidth(390);
    pageApi();
    renderApp({ path: '/exercises' });
    const section = await findSection(/^In progress/);
    const b7 = elWith('.page-row', 'National B, B-7', section);
    expect(el('.page-row-gap', b7).textContent).toBe('0.07 s');
    expect(el('.page-row-name span', elWith('.page-row', 'Sector 2', section)).textContent).toBe('Circuit Experience · Autódromo de Interlagos');
  });

  it('a_new_player_sees_the_lede_and_every_group_closed', async () => {
    pageApi([]);
    renderApp({ path: '/exercises' });
    expect(await screen.findByText('Select a test or a sector of the game. Record the demonstration of the game as the reference, then drive.')).toBeInTheDocument();
    await findEl('.catalogue-group');
    expect(maybeEl('section.continue')).toBeNull();
    expect(maybeSection(/^In progress/)).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Catalogue 8' })).toBeInTheDocument();
    expect(els('.family-label').map(node => node.textContent)).toEqual(['Licence', 'Circuit Experience', 'Brand Central', 'Own']);
    expect(groupTitles()).toEqual(['National B', 'National A', 'Autódromo de Interlagos', 'Tsukuba Circuit', 'Yangwang', 'Your own exercise']);
    expect(els('[data-entry]')).toHaveLength(0);
    expect(groupHeader('National B')).toHaveTextContent('4 tests');
    expect(groupHeader('Autódromo de Interlagos')).toHaveTextContent('1 sector');
    expect(groupHeader('Yangwang')).toHaveTextContent('1 exercise');
  });

  it('a_new_player_on_a_phone_sees_the_title', async () => {
    setViewportWidth(390);
    pageApi([]);
    renderApp({ path: '/exercises' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Exercises' })).toBeInTheDocument();
  });

  it('a_phone_shows_the_title_above_the_lede_also_with_a_continue_card', async () => {
    setViewportWidth(390);
    pageApi([B9]);
    renderApp({ path: '/exercises' });
    await findEl('section.continue');
    expect(screen.getByRole('heading', { level: 1, name: 'Exercises' })).toBeInTheDocument();
    expect(screen.getByText(/^Select a test or a sector of the game/)).toBeInTheDocument();
  });

  it('opens_a_group_and_shows_its_rows_with_their_state', async () => {
    pageApi();
    renderApp({ path: '/exercises' });
    await findEl('.catalogue-group');
    expect(groupHeader('National B')).toHaveTextContent('4 tests · 1 at target · 1 in progress');
    expect(groupHeader('National B')).toHaveAttribute('aria-expanded', 'false');
    const national = await openGroup('National B');
    expect(groupHeader('National B')).toHaveAttribute('aria-expanded', 'true');
    expect(els('[data-entry]', national).map(row => row.dataset.entry)).toEqual(['licence-b-5', 'licence-b-7', 'licence-b-9', 'licence-b-10']);
    expect(el('.tag', catalogueRow('licence-b-5'))).toHaveTextContent('Target reached');
    expect(catalogueRow('licence-b-5')).toHaveTextContent('0:13.024');
    expect(rowLink('licence-b-5')).toHaveAttribute('href', `/exercises/${B5.id}`);
    expect(el('.page-row-name b', catalogueRow('licence-b-5')).textContent).toBe('B-5');
    expect(el('.page-row-name span', catalogueRow('licence-b-5')).textContent).toBe('Cornering Basics 3');
    expect(catalogueRow('licence-b-7')).toHaveTextContent('0.07 s to the target');
    expect(rowLink('licence-b-7')).toHaveClass('current');
    expect(catalogueRow('licence-b-9')).toHaveTextContent('target 0:17.800');
    expect(within(catalogueRow('licence-b-9')).getByRole('link', { name: 'Record the reference' })).toBeInTheDocument();
    expect(catalogueRow('licence-b-10')).toHaveTextContent('target 0:25.300');
    expect(within(catalogueRow('licence-b-10')).getByRole('button', { name: 'Record the reference' })).toBeInTheDocument();
    await userEvent.setup().click(groupHeader('National B'));
    expect(els('[data-entry]')).toHaveLength(0);
  });

  it('a_sector_row_shows_its_code_and_a_brand_row_its_name', async () => {
    pageApi();
    renderApp({ path: '/exercises' });
    await openGroup('Tsukuba Circuit');
    expect(el('.page-row-name', catalogueRow('ce-tsukuba-s1')).textContent).toBe('Sector 1');
    expect(catalogueRow('ce-tsukuba-s1')).not.toHaveTextContent('Asia/Oceania');
    await openGroup('Yangwang');
    expect(el('.page-row-name b', catalogueRow('brand-yangwang-racing-lines')).textContent).toBe('EXP-1');
    expect(el('.page-row-name span', catalogueRow('brand-yangwang-racing-lines')).textContent).toBe('Racing Lines');
  });

  it('record_the_reference_creates_the_exercise_once_and_opens_the_recording', async () => {
    const created = exercise({ id: ID(20), catalogueId: 'licence-b-10', family: 'Licence', collection: 'National B', code: 'B-10', name: 'Driving Basics', activeReferenceId: null, referenceCount: 0 });
    let release: () => void = () => undefined;
    const api = pageApi().on('POST /api/exercises', () => new Promise(resolve => (release = () => resolve({ status: 201, body: created }))));
    renderApp({ path: '/exercises' });
    await openGroup('National B');
    const button = within(catalogueRow('licence-b-10')).getByRole('button', { name: 'Record the reference' });
    const user = userEvent.setup();
    await user.click(button);
    await waitFor(() => expect(api.called('POST /api/exercises')).toBe(true));
    expect(button).toBeDisabled();
    await user.click(button);
    act(() => release());
    await waitFor(() => expect(window.location.pathname).toBe(`/exercises/${created.id}/record`));
    expect(api.calls.filter(call => call.method === 'POST' && call.path === '/api/exercises').map(call => call.body)).toEqual([{ catalogueId: 'licence-b-10' }]);
    expect(window.localStorage.getItem(`gt7.currentExercise.${USER.id}`)).toBe(created.id);
  });

  it('record_the_reference_shows_a_failure', async () => {
    pageApi().on('POST /api/exercises', { status: 409, body: { code: 'busy' } });
    renderApp({ path: '/exercises' });
    await openGroup('National B');
    const button = within(catalogueRow('licence-b-10')).getByRole('button', { name: 'Record the reference' });
    await userEvent.setup().click(button);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(button).toBeEnabled();
  });

  it('record_the_reference_on_an_existing_exercise_without_a_reference_opens_its_recording', async () => {
    const api = pageApi();
    renderApp({ path: '/exercises' });
    await openGroup('National B');
    await userEvent.setup().click(within(catalogueRow('licence-b-9')).getByRole('link', { name: 'Record the reference' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/exercises/${B9.id}/record`));
    expect(api.called('POST /api/exercises')).toBe(false);
  });

  it('a_search_opens_the_matching_groups', async () => {
    pageApi();
    renderApp({ path: '/exercises' });
    await findEl('.catalogue-group');
    await userEvent.setup().type(el('input[type="search"]'), 'tsukuba');
    expect(groupTitles()).toEqual(['National B', 'National A', 'Tsukuba Circuit']);
    expect(els('[data-entry]').map(row => row.dataset.entry)).toEqual(['licence-b-5', 'licence-b-10', 'licence-a-1', 'ce-tsukuba-s1']);
    expect(maybeSection(/^In progress/)).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Catalogue 4' })).toBeInTheDocument();
  });

  it('a_search_by_code_finds_the_entry_and_the_exercise_in_progress', async () => {
    pageApi();
    renderApp({ path: '/exercises' });
    await findEl('.catalogue-group');
    await userEvent.setup().type(el('input[type="search"]'), 'b-7');
    expect(rowNames(inProgress())).toEqual(['National B, B-7']);
    expect(els('[data-entry]').map(row => row.dataset.entry)).toEqual(['licence-b-7']);
  });

  it('no_match_shows_clear_filters', async () => {
    pageApi();
    renderApp({ path: '/exercises' });
    await findEl('.catalogue-group');
    const user = userEvent.setup();
    await user.type(el('input[type="search"]'), 'zzzz');
    expect(screen.getByText('No exercise matches.')).toBeInTheDocument();
    expect(screen.getByText('Check the spelling, or clear the filters.')).toBeInTheDocument();
    expect(maybeSection(/^In progress/)).toBeNull();
    expect(maybeEl('.catalogue-group')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(el('input[type="search"]')).toHaveValue('');
    expect(groupTitles()).toHaveLength(6);
    expect(rowNames(inProgress())).toHaveLength(3);
  });

  it('the_family_chips_filter_the_whole_page', async () => {
    pageApi();
    renderApp({ path: '/exercises' });
    await findEl('.catalogue-group');
    const chips = el('.family-chips');
    expect(within(chips).getAllByRole('button').map(button => button.textContent)).toEqual(['All', 'Licence', 'Circuit Experience', 'Brand Central', 'Own']);
    expect(within(chips).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    const user = userEvent.setup();
    await user.click(within(chips).getByRole('button', { name: 'Licence' }));
    expect(within(chips).getByRole('button', { name: 'Licence' })).toHaveAttribute('aria-pressed', 'true');
    expect(groupTitles()).toEqual(['National B', 'National A']);
    expect(rowNames(inProgress())).toEqual(['National B, B-7']);
    await user.click(within(chips).getByRole('button', { name: 'Own' }));
    expect(groupTitles()).toEqual(['Your own exercise']);
    expect(rowNames(inProgress())).toEqual(['Fuji short']);
    expect(rowNames(el('.own-group'))).toEqual(['Fuji short']);
  });

  it('the_track_filter_applies_to_in_progress_and_groups', async () => {
    pageApi();
    renderApp({ path: '/exercises' });
    await findEl('.catalogue-group');
    const select = el('select.track-filter') as HTMLSelectElement;
    expect([...select.options].map(option => option.textContent)).toEqual(['All tracks', 'Autódromo de Interlagos', 'Dragon Trail - Seaside', 'SUGO', 'Trial Mountain Circuit', 'Tsukuba Circuit']);
    await userEvent.setup().selectOptions(select, 'Autódromo de Interlagos');
    expect(rowNames(inProgress())).toEqual(['Sector 2']);
    expect(groupTitles()).toEqual(['Autódromo de Interlagos']);
    expect(els('[data-entry]').map(row => row.dataset.entry)).toEqual(['ce-interlagos-s2']);
  });

  it('on_a_phone_a_row_opens_in_place_with_track_car_target_and_the_button', async () => {
    setViewportWidth(390);
    pageApi();
    renderApp({ path: '/exercises' });
    await findEl('.catalogue-group');
    expect(groupHeader('National B')).toHaveTextContent('1 of 4 at target');
    expect(groupHeader('Autódromo de Interlagos')).toHaveTextContent('1 in progress');
    expect(groupHeader('Tsukuba Circuit')).toHaveTextContent('1 sector');
    await openGroup('National B');
    expect(rowLink('licence-b-7').tagName).toBe('A');
    expect(el('.page-row-gap', catalogueRow('licence-b-7')).textContent).toBe('0.07 s');
    expect(catalogueRow('licence-b-7')).not.toHaveTextContent('Trial Mountain Circuit');
    const b10 = catalogueRow('licence-b-10');
    expect(b10).toHaveTextContent('target 0:25.300');
    expect(b10).not.toHaveTextContent('Renault');
    const user = userEvent.setup();
    await user.click(within(b10).getByRole('button', { name: /B-10/ }));
    expect(catalogueRow('licence-b-10')).toHaveTextContent("Tsukuba CircuitRenault Sport Clio R.S. 220 EDC Trophy '16target 0:25.300");
    expect(within(catalogueRow('licence-b-10')).getByRole('button', { name: 'Record the reference' })).toBeInTheDocument();
    await user.click(within(catalogueRow('licence-b-9')).getByRole('button', { name: /B-9/ }));
    expect(within(catalogueRow('licence-b-9')).getByRole('link', { name: 'Record the reference' })).toBeInTheDocument();
    expect(within(catalogueRow('licence-b-10')).queryByRole('button', { name: 'Record the reference' })).toBeNull();
  });

  it('your_own_exercise_opens_the_form_and_creates_the_exercise', async () => {
    const created = exercise({ id: ID(21), catalogueId: null, family: 'Time Trial', name: 'Fuji', activeReferenceId: null, referenceCount: 0 });
    const api = pageApi().on('POST /api/exercises', { status: 201, body: created }).on(`GET /api/exercises/${created.id}`, created);
    renderApp({ path: '/exercises' });
    await findEl('.catalogue-group');
    expect(maybeEl('form.own-exercise')).toBeNull();
    expect(groupHeader('Your own exercise')).toHaveTextContent('For an activity that the catalogue does not list');
    const user = userEvent.setup();
    await user.click(groupHeader('Your own exercise'));
    const form = el('form.own-exercise');
    const create = iconButton('Create exercise', form);
    expect(create.textContent).toBe('');
    expect(create.querySelector('[data-icon="check"]')).not.toBeNull();
    await user.click(create);
    expect(within(form).getByRole('alert')).toHaveTextContent('Enter an activity and a name.');
    await user.type(within(form).getByLabelText('Name'), 'Fuji');
    await user.click(create);
    await waitFor(() => expect(window.location.pathname).toBe(`/exercises/${created.id}`));
    expect(api.calls.find(call => call.method === 'POST' && call.path === '/api/exercises')?.body).toEqual({ family: 'Time Trial', name: 'Fuji' });
    expect(window.localStorage.getItem(`gt7.currentExercise.${USER.id}`)).toBe(created.id);
  });

  it('the_page_ends_with_the_sources', async () => {
    pageApi();
    renderApp({ path: '/exercises' });
    expect(await screen.findByText(/^Sources: ddm999\/gt7info \(MIT-0\)\. A catalogue entry does not mean that GT7 Tutor supports the exercise\.$/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/baseline|guided|without voice|checked|verified/i);
  });

  it('without_a_console_address_shows_get_ready', async () => {
    pageApi(ALL, null);
    renderApp({ path: '/exercises' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Get ready to train' })).toBeInTheDocument();
    expect(maybeSection(/^In progress/)).toBeNull();
  });

  it('redirects_to_drive_when_armed', async () => {
    pageApi();
    const view = renderApp({ path: '/exercises' });
    await findSection(/^In progress/);
    await openLive(view.sockets, liveState({ mode: 'armed', exerciseId: B7.id, connection: 'connected' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/exercises/${B7.id}/drive`));
    window.history.back();
  });

  it('select_mode_lists_every_exercise_record_and_deletes_the_picked_ones', async () => {
    const api = pageApi().on('POST /api/exercises/remove', { exercises: 2, attempts: 6, references: 2, cleanup: null });
    rememberExercise(B7.id);
    renderApp({ path: '/exercises' });
    const section = await findSection(/^In progress/);
    const user = userEvent.setup();
    await user.click(within(section).getByRole('button', { name: 'Select' }));
    expect(rowNames(section)).toEqual(['National B, B-5', 'National B, B-7', 'National B, B-9', 'Sector 2', 'Fuji short']);
    expect(within(section).queryByRole('link', { name: /B-7/ })).toBeNull();
    expect(elWith('.page-row', 'National B, B-7', section)).toHaveTextContent('6 attempts, 2 references');
    expect(elWith('.page-row', 'National B, B-9', section)).toHaveTextContent('no attempts, no reference');
    await user.click(el('input', elWith('.page-row', 'National B, B-7', section)));
    await user.click(el('input', elWith('.page-row', 'National B, B-9', section)));
    const bar = el('.selection-bar');
    expect(bar).toHaveTextContent('2 selected');
    await user.click(within(bar).getByRole('button', { name: 'Delete 2 exercises' }));
    const dialog = dialogOf('Delete 2 exercises?');
    expect(dialog).toHaveTextContent('National B, B-7, 6 attempts, 2 references');
    expect(dialog).toHaveTextContent('National B, B-9, no attempts, no reference');
    expect(dialog).toHaveTextContent('The catalogue entries stay. You can record their references again from the catalogue. You cannot undo it.');
    const before = api.calls.filter(call => `${call.method} ${call.path}` === 'GET /api/exercises').length;
    await user.click(within(dialog).getByRole('button', { name: 'Delete 2 exercises' }));
    await waitFor(() => expect(api.called('POST /api/exercises/remove')).toBe(true));
    const body = api.calls.find(call => call.path === '/api/exercises/remove')!.body as { ids: string[]; cleanup: boolean };
    expect({ ids: [...body.ids].sort(), cleanup: body.cleanup }).toEqual({ ids: [B7.id, B9.id].sort(), cleanup: true });
    await waitFor(() => expect(api.calls.filter(call => `${call.method} ${call.path}` === 'GET /api/exercises').length).toBeGreaterThan(before));
    expect(maybeEl('.selection-bar')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(`gt7.currentExercise.${USER.id}`)).toBeNull();
  });

  it('select_mode_follows_the_page_filters', async () => {
    pageApi();
    renderApp({ path: '/exercises' });
    await findSection(/^In progress/);
    const user = userEvent.setup();
    await user.click(within(el('.family-chips')).getByRole('button', { name: 'Licence' }));
    const section = sectionOf(/^In progress/);
    await user.click(within(section).getByRole('button', { name: 'Select' }));
    expect(rowNames(section)).toEqual(['National B, B-5', 'National B, B-7', 'National B, B-9']);
    await user.click(within(section).getByRole('button', { name: 'All (3)' }));
    expect(el('.selection-bar')).toHaveTextContent('3 selected');
    expect(within(section).getByRole('button', { name: 'Without history (1)' })).toBeInTheDocument();
  });

  it('select_mode_shows_with_no_exercise_in_progress', async () => {
    pageApi([B9]);
    renderApp({ path: '/exercises' });
    const section = await findSection(/^In progress/);
    expect(section).toHaveTextContent('No exercise in progress.');
    await userEvent.setup().click(within(section).getByRole('button', { name: 'Select' }));
    expect(rowNames(section)).toEqual(['National B, B-9']);
  });

  it('quick_select_without_history', async () => {
    pageApi();
    renderApp({ path: '/exercises' });
    const section = await findSection(/^In progress/);
    const user = userEvent.setup();
    await user.click(within(section).getByRole('button', { name: 'Select' }));
    await user.click(within(section).getByRole('button', { name: 'Without history (1)' }));
    expect(el('input', elWith('.page-row', 'National B, B-9', section))).toBeChecked();
    expect(el('input', elWith('.page-row', 'National B, B-7', section))).not.toBeChecked();
    await user.click(within(section).getByRole('button', { name: 'All (5)' }));
    expect(el('.selection-bar')).toHaveTextContent('5 selected');
    await user.click(within(section).getByRole('button', { name: 'None' }));
    expect(screen.getByRole('button', { name: 'Delete 0 exercises' })).toBeDisabled();
    for (const button of screen.getAllByRole('button')) expect(button.textContent).not.toMatch(/…$/);
  });

  it('remove_one_exercise_lists_what_goes', async () => {
    setViewportWidth(390);
    const api = pageApi().on('POST /api/exercises/remove', { exercises: 1, attempts: 6, references: 2, cleanup: null });
    renderApp({ path: '/exercises' });
    const section = await findSection(/^In progress/);
    const user = userEvent.setup();
    await user.click(within(section).getByRole('button', { name: 'Select' }));
    await user.click(el('input', elWith('.page-row', 'National B, B-7', section)));
    expect(within(el('.selection-bar')).queryByRole('button', { name: 'Delete 1 exercise' })).toBeNull();
    await user.click(within(el('.selection-bar')).getByRole('button', { name: 'Delete' }));
    const dialog = dialogOf('Delete National B, B-7?');
    expect(dialog).toHaveTextContent('6 attempts, with their cues and differences');
    expect(dialog).toHaveTextContent('your best time 0:17.867');
    expect(dialog).toHaveTextContent('National B, B-7 is your current exercise. The Drive button and Continue move to another exercise.');
    expect(dialog).toHaveTextContent('The catalogue entry stays. You can record its reference again from the catalogue. You cannot undo it.');
    await user.click(within(dialog).getByRole('button', { name: 'Delete exercise' }));
    await waitFor(() => expect(api.called('POST /api/exercises/remove')).toBe(true));
    expect(api.calls.find(call => call.path === '/api/exercises/remove')!.body).toEqual({ ids: [B7.id], cleanup: true });
  });

  it('remove_busy_shows_message', async () => {
    pageApi().on('POST /api/exercises/remove', { status: 409, body: { code: 'busy' } });
    renderApp({ path: '/exercises' });
    const section = await findSection(/^In progress/);
    const user = userEvent.setup();
    await user.click(within(section).getByRole('button', { name: 'Select' }));
    await user.click(el('input', elWith('.page-row', 'National B, B-9', section)));
    await user.click(screen.getByRole('button', { name: 'Delete 1 exercise' }));
    const dialog = screen.getByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete exercise' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Stop the training or the recording first.');
  });
});
