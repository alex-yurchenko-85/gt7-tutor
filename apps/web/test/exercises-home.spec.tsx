import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Exercise, Progress } from '@gt7/contracts';
import { trackTargetSave } from '../src/features/exercise/target-save.ts';
import { catalogueEntry, exercise, exerciseApi, rememberExercise, EXERCISE_ID } from './fixtures.ts';
import { liveState, renderApp, setViewportWidth, openLive, sectionOf, maybeSection, findSection, dialogOf, el, findEl, maybeEl, elWith } from './support.tsx';

const RACING = exercise({
  id: EXERCISE_ID,
  catalogueId: 'brand-yangwang-racing-lines',
  name: 'Racing Line: Intermediate',
  family: 'Brand Central',
  status: 'practising',
  completeAttempts: 2,
  attemptCount: 6,
  referenceCount: 2,
  bestMs: 26900,
  targetMs: 26000,
  targetGapMs: 900
});

const BASICS = exercise({
  id: 'e0000000-0000-4000-8000-000000000002',
  catalogueId: 'licence-b-3',
  name: 'Cornering Basics 1',
  family: 'Licence',
  collection: 'National B',
  code: 'B-3',
  status: 'new',
  activeReferenceId: null,
  referenceCount: 0,
  createdAt: '2026-11-15T10:00:00.000Z'
});

const PROGRESS: Progress = {
  collections: [
    { family: 'Brand Central', collection: 'Yangwang', counts: { new: 0, practising: 1, 'target-reached': 0 } },
    { family: 'Licence', collection: 'National B', counts: { new: 2, practising: 1, 'target-reached': 1 } }
  ],
  exercises: [
    { id: EXERCISE_ID, name: RACING.name, family: 'Brand Central', collection: 'Yangwang', status: 'practising', bestMs: 27100, bestByDay: [] },
    { id: 'e0000000-0000-4000-8000-000000000002', name: BASICS.name, family: 'Licence', collection: 'National B', status: 'new', bestMs: null, bestByDay: [] }
  ]
};

const CATALOGUE = [
  catalogueEntry({ id: 'brand-yangwang-racing-lines', family: 'Brand Central', collection: 'Yangwang', code: 'EXP-1', name: RACING.name, track: 'SUGO', car: "Yangwang U9 '24" }),
  catalogueEntry({ id: 'licence-b-3', family: 'Licence', collection: 'National B', code: 'B-3', name: BASICS.name, track: 'Alsace - Village', car: null })
];

function homeApi(exercises: Exercise[] = [RACING, BASICS], ps5Ip: string | null = '192.0.2.10') {
  rememberExercise(EXERCISE_ID);
  return exerciseApi(RACING)
    .on('GET /api/exercises', exercises)
    .on('GET /api/progress', PROGRESS)
    .on('GET /api/catalogue', CATALOGUE)
    .on('GET /api/settings', { ps5Ip, gameVersion: '1.65' })
    .install();
}

describe('exercises home', () => {
  it('home_reads_the_exercises_after_a_pending_target_save', async () => {
    let finish: (value: unknown) => void = () => undefined;
    void trackTargetSave(new Promise(resolve => (finish = resolve)));
    const api = homeApi();
    renderApp();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(api.calls.some(call => call.method === 'GET' && call.path === '/api/exercises')).toBe(false);
    finish(undefined);
    expect(await findSection('Yangwang, EXP-1')).toHaveTextContent('Continue');
  });

  it('home_shows_continue_card_for_current_exercise', async () => {
    homeApi();
    renderApp();
    const card = await findSection('Yangwang, EXP-1');
    expect(card).toHaveTextContent('Continue');
    expect(card).toHaveTextContent('0:26.900your best time');
    expect(card).toHaveTextContent('0.90 s');
    expect(card).toHaveTextContent('to the target, 0:26.000');
    expect(card).not.toHaveTextContent('gold');
    expect(card).not.toHaveTextContent('Next:');
    expect(within(card).queryByRole('list', { name: 'Three steps' })).toBeNull();
    const drive = within(card).getByRole('button', { name: 'Drive' });
    expect(drive).toHaveClass('continue-primary');
    expect(drive.querySelector('[data-icon="drive"]')).not.toBeNull();
    expect(within(card).getByRole('link', { name: 'Attempts' })).toHaveAttribute('href', `/exercises/${EXERCISE_ID}/attempts`);
    expect(within(card).getByRole('link', { name: 'Yangwang, EXP-1' })).toHaveAttribute('href', `/exercises/${EXERCISE_ID}`);
    expect(within(card).queryByRole('link', { name: 'Open the exercise' })).toBeNull();
    expect(within(card).queryByRole('link', { name: /^Open the attempts|^Start an attempt/ })).toBeNull();
  });

  it('continue_card_shows_the_code_as_the_title_and_the_name_in_the_kicker', async () => {
    homeApi();
    renderApp();
    const card = await findSection('Yangwang, EXP-1');
    expect(el('.continue-kicker', card).textContent).toBe('Continue · Brand Central · Racing Line: Intermediate · SUGO');
  });

  it('continue_card_on_phone_shows_only_continue_above_a_code_title', async () => {
    setViewportWidth(390);
    homeApi();
    renderApp();
    const card = await findSection('Yangwang, EXP-1');
    expect(el('.continue-kicker', card).textContent).toBe('Continue');
  });

  it('continue_card_has_no_gap_part_without_a_target_or_a_best_time', async () => {
    homeApi([exercise({ ...RACING, targetMs: null, targetGapMs: null })]);
    renderApp();
    const card = await findSection('Yangwang, EXP-1');
    expect(card).toHaveTextContent('your best time');
    expect(card).not.toHaveTextContent('to the target');
  });

  it('continue_card_has_no_gap_part_without_a_best_time', async () => {
    homeApi([exercise({ ...RACING, bestMs: null, targetGapMs: null })]);
    renderApp();
    const card = await findSection('Yangwang, EXP-1');
    expect(card).not.toHaveTextContent('your best time');
    expect(card).not.toHaveTextContent('to the target');
  });

  it('continue_card_on_phone_has_no_gap_part_without_a_target', async () => {
    setViewportWidth(390);
    homeApi([exercise({ ...RACING, targetMs: null, targetGapMs: null })]);
    renderApp();
    const card = await findSection('Yangwang, EXP-1');
    expect(card).toHaveTextContent('best 0:26.900');
    expect(card).not.toHaveTextContent('to the target');
  });

  it('rows_tag_new_and_target_reached_and_leave_practising_without_a_tag', async () => {
    const reached = exercise({ id: 'e0000000-0000-4000-8000-000000000003', catalogueId: 'licence-b-3', name: 'Done', family: 'Licence', status: 'target-reached', bestMs: 13000, targetMs: 13100 });
    homeApi([RACING, BASICS, reached]);
    renderApp();
    const mine = await findSection(/My exercises/);
    expect(el('.tag', elWith('.exercise-row', 'Cornering Basics 1', mine))).toHaveTextContent('New');
    expect(el('.tag', elWith('.exercise-row', 'Done', mine))).toHaveTextContent('Target reached');
    expect(maybeEl('.tag', elWith('.exercise-row', 'Racing Line: Intermediate', mine))).toBeNull();
    expect(mine).not.toHaveTextContent('Practising');
  });

  it('licences_follow_the_catalogue_order_and_own_exercises_come_last', async () => {
    const make = (n: number, name: string, catalogueId: string | null, createdAt: string, collection: string | null = null, code: string | null = null) =>
      exercise({ id: `e0000000-0000-4000-8000-00000000010${n}`, catalogueId, name, family: 'Licence', collection, code, status: 'new', activeReferenceId: null, referenceCount: 0, createdAt });
    const superLicence = make(1, 'Super One', 'licence-s-1', '2026-11-10T10:00:00.000Z', 'Super', 'S-1');
    const nationalA = make(2, 'A One', 'licence-a-1', '2026-11-11T10:00:00.000Z', 'National A', 'A-1');
    const nationalB = make(3, 'B One', 'licence-b-1', '2026-11-12T10:00:00.000Z', 'National B', 'B-1');
    const ownLate = make(4, 'Own Late', null, '2026-11-14T10:00:00.000Z');
    const ownEarly = make(5, 'Own Early', null, '2026-11-13T10:00:00.000Z');
    rememberExercise(EXERCISE_ID);
    exerciseApi(RACING)
      .on('GET /api/exercises', [RACING, ownLate, superLicence, nationalA, ownEarly, nationalB])
      .on('GET /api/progress', PROGRESS)
      .on('GET /api/catalogue', [
        catalogueEntry({ id: 'licence-b-1', collection: 'National B', code: 'B-1', name: 'B One' }),
        catalogueEntry({ id: 'licence-a-1', collection: 'National A', code: 'A-1', name: 'A One' }),
        catalogueEntry({ id: 'licence-s-1', collection: 'Super', code: 'S-1', name: 'Super One' }),
        ...CATALOGUE
      ])
      .on('GET /api/settings', { ps5Ip: '192.0.2.10', gameVersion: '1.65' })
      .install();
    renderApp();
    const mine = await findSection(/My exercises/);
    const licence = elWith('.family-group', /^Licence/, mine);
    const names = [...licence.querySelectorAll('.exercise-row-name b')].map(node => node.textContent);
    expect(names).toEqual(['National B, B-1', 'National A, A-1', 'Super, S-1', 'Own Early', 'Own Late']);
  });

  it('circuit_experience_rows_show_no_region_and_no_code', async () => {
    const sector = exercise({
      id: 'e0000000-0000-4000-8000-000000000201',
      catalogueId: 'ce-tsukuba-s1',
      name: 'Tsukuba Circuit · Sector 1',
      family: 'Circuit Experience',
      status: 'new',
      activeReferenceId: null,
      referenceCount: 0
    });
    rememberExercise(EXERCISE_ID);
    exerciseApi(RACING)
      .on('GET /api/exercises', [RACING, sector, BASICS])
      .on('GET /api/progress', {
        ...PROGRESS,
        exercises: [...PROGRESS.exercises, { id: sector.id, name: sector.name, family: 'Circuit Experience', collection: 'Asia', status: 'new', bestMs: null, bestByDay: [] }]
      })
      .on('GET /api/catalogue', [
        ...CATALOGUE,
        catalogueEntry({ id: 'ce-tsukuba-s1', family: 'Circuit Experience', collection: 'Asia', code: 'Sector 1', name: sector.name, track: 'Tsukuba Circuit', car: 'Mitsubishi Lancer Evolution Final Edition Gr.4' })
      ])
      .on('GET /api/settings', { ps5Ip: '192.0.2.10', gameVersion: '1.65' })
      .install();
    renderApp();
    const mine = await findSection(/My exercises/);
    const row = elWith('.exercise-row', 'Tsukuba Circuit · Sector 1', mine);
    expect(el('.exercise-row-name span', row).textContent).toBe('Tsukuba Circuit · Mitsubishi Lancer Evolution Final Edition Gr.4');
    const basics = elWith('.exercise-row', 'National B, B-3', mine);
    expect(el('b', basics).textContent).toBe('National B, B-3');
    expect(el('.exercise-row-name span', basics).textContent).toBe('Cornering Basics 1 · Alsace - Village');
  });

  it('phone_rows_show_the_licence_code_and_no_region_for_a_sector', async () => {
    setViewportWidth(390);
    const sector = exercise({
      id: 'e0000000-0000-4000-8000-000000000201',
      catalogueId: 'ce-tsukuba-s1',
      name: 'Tsukuba Circuit · Sector 1',
      family: 'Circuit Experience',
      status: 'new',
      activeReferenceId: null,
      referenceCount: 0
    });
    rememberExercise(EXERCISE_ID);
    exerciseApi(RACING)
      .on('GET /api/exercises', [RACING, sector, BASICS])
      .on('GET /api/progress', {
        ...PROGRESS,
        exercises: [...PROGRESS.exercises, { id: sector.id, name: sector.name, family: 'Circuit Experience', collection: 'Asia', status: 'new', bestMs: null, bestByDay: [] }]
      })
      .on('GET /api/catalogue', [...CATALOGUE, catalogueEntry({ id: 'ce-tsukuba-s1', family: 'Circuit Experience', collection: 'Asia', code: 'Sector 1', name: sector.name, track: 'Tsukuba Circuit' })])
      .on('GET /api/settings', { ps5Ip: '192.0.2.10', gameVersion: '1.65' })
      .install();
    renderApp();
    const mine = await findSection(/My exercises/);
    await waitFor(() => expect(el('.exercise-row-name span', elWith('.exercise-row', 'National B, B-3', mine)).textContent).toBe('Licence · Cornering Basics 1'));
    expect(el('.exercise-row-name span', elWith('.exercise-row', 'Tsukuba Circuit · Sector 1', mine)).textContent).toBe('Circuit Experience');
    expect(el('.exercise-row-name span', elWith('.exercise-row', 'Yangwang, EXP-1', mine)).textContent).toBe('Brand Central · Racing Line: Intermediate');
  });

  it('home_has_no_attempt_mode_text', async () => {
    homeApi();
    renderApp();
    await screen.findByRole('button', { name: 'Drive' });
    expect(document.body.textContent).not.toMatch(/baseline|guided|without voice|No device plays the voice/i);
  });

  it('home_lists_exercises_grouped_by_family', async () => {
    homeApi();
    renderApp();
    const mine = await findSection(/My exercises/);
    const licence = elWith('.family-group', /^Licence/, mine);
    const row = within(licence).getByRole('link', { name: /Cornering Basics 1/ });
    expect(row).toHaveAttribute('href', '/exercises/e0000000-0000-4000-8000-000000000002');
    expect(row).toHaveTextContent('National B, B-3');
    expect(row).toHaveTextContent('New');
    expect(row).not.toHaveTextContent('Next:');
    const brand = elWith('.family-group', /^Brand Central/, mine);
    const racing = within(brand).getByRole('link', { name: /Racing Line: Intermediate/ });
    expect(racing).toHaveTextContent('0:26.900');
    expect(racing).not.toHaveTextContent('Next:');
    expect(racing).toHaveTextContent('SUGO');
  });

  it('home_filter_by_family', async () => {
    homeApi();
    renderApp();
    const mine = await findSection(/My exercises/);
    const filter = el('.family-filter', mine);
    expect(within(filter).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.setup().click(within(filter).getByRole('button', { name: 'Licence' }));
    expect(within(filter).getByRole('button', { name: 'Licence' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(mine).queryByRole('link', { name: /Racing Line/ })).toBeNull();
    expect(within(mine).getByRole('link', { name: /Cornering Basics 1/ })).toBeInTheDocument();
  });

  it('home_links_add_exercise', async () => {
    setViewportWidth(390);
    homeApi();
    renderApp();
    expect(await findEl('a.add-exercise')).toHaveAttribute('href', '/exercises/add');
  });

  it('home_without_console_shows_get_ready', async () => {
    homeApi([RACING, BASICS], null);
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'Get ready to train' })).toBeInTheDocument();
    expect(screen.getByLabelText('PS5 address')).toBeInTheDocument();
    expect(maybeSection(/My exercises/)).toBeNull();
  });

  it('home_without_exercise_shows_get_ready', async () => {
    homeApi([]);
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'Get ready to train' })).toBeInTheDocument();
  });

  it('home_redirects_to_drive_when_armed', async () => {
    homeApi();
    const view = renderApp();
    await findSection(/My exercises/);
    await openLive(view.sockets, liveState({ mode: 'armed', exerciseId: EXERCISE_ID, connection: 'connected' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/exercises/${EXERCISE_ID}/drive`));
    window.history.back();
  });

  it('home_has_no_collections_and_no_next_column', async () => {
    homeApi();
    renderApp();
    await screen.findByRole('link', { name: /Cornering Basics 1/ });
    expect(screen.queryByRole('table', { name: 'Collections' })).toBeNull();
    expect(screen.queryByText('Collections')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Three steps' })).toBeNull();
    expect(document.querySelector('.exercise-row-next')).toBeNull();
  });

  it('continue_card_on_phone_shows_the_best_time_and_the_gap', async () => {
    setViewportWidth(390);
    homeApi();
    renderApp();
    const card = await findSection('Yangwang, EXP-1');
    expect(card).toHaveTextContent('best 0:26.900 · 0.90 s to the target');
    expect(card).not.toHaveTextContent('Next');
    expect(within(card).getByRole('button', { name: 'Drive' })).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Attempts' })).toHaveClass('continue-link');
  });

  it('continue_without_a_reference_links_to_the_recording', async () => {
    homeApi();
    window.localStorage.setItem('gt7.currentExercise.user-1', BASICS.id);
    renderApp();
    const card = await findSection('National B, B-3');
    expect(within(card).getByRole('link', { name: 'Record the reference' })).toHaveAttribute('href', `/exercises/${BASICS.id}/record`);
    expect(within(card).queryByRole('button', { name: 'Drive' })).toBeNull();
  });

  it('continue_drive_arms_and_opens_the_stage', async () => {
    const api = homeApi().on('POST /api/training/arm', { status: 201, body: { captureId: 'cap-9', exerciseId: EXERCISE_ID, referenceId: 'ref-demo' } });
    renderApp();
    const card = await findSection('Yangwang, EXP-1');
    await userEvent.setup().click(within(card).getByRole('button', { name: 'Drive' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/exercises/${EXERCISE_ID}/drive`));
    expect(api.calls.find(call => call.path === '/api/training/arm')?.body).toEqual({ exerciseId: EXERCISE_ID });
  });

  it('filter_lists_only_families_with_exercises', async () => {
    homeApi();
    renderApp();
    const filter = await findEl('.family-filter');
    expect(within(filter).getAllByRole('button').map(button => button.textContent)).toEqual(['All', 'Licence', 'Brand Central']);
  });

  it('filter_is_hidden_with_one_family', async () => {
    homeApi([RACING]);
    renderApp();
    await findSection(/My exercises/);
    expect(maybeEl('.family-filter')).toBeNull();
  });

  it('select_and_remove_exercises', async () => {
    const api = homeApi().on('POST /api/exercises/remove', { exercises: 2, attempts: 6, references: 2, cleanup: null });
    renderApp();
    const mine = await findSection(/My exercises/);
    await userEvent.click(within(mine).getByRole('button', { name: 'Select' }));
    const racing = el('input', elWith('.exercise-row', 'Racing Line: Intermediate', mine));
    expect(racing.closest('.exercise-row')).toHaveTextContent('6 attempts, 2 references');
    expect(el('input', elWith('.exercise-row', 'Cornering Basics 1', mine)).closest('.exercise-row')).toHaveTextContent('no attempts, no reference');
    expect(within(mine).queryByRole('link', { name: /Racing Line/ })).toBeNull();
    await userEvent.click(racing);
    await userEvent.click(el('input', elWith('.exercise-row', 'Cornering Basics 1', mine)));
    const bar = el('.selection-bar');
    expect(bar).toHaveTextContent('2 selected');
    await userEvent.click(within(bar).getByRole('button', { name: 'Delete 2 exercises' }));
    const dialog = dialogOf('Delete 2 exercises?');
    expect(dialog).toHaveTextContent('Yangwang, EXP-1, 6 attempts, 2 references');
    expect(dialog).toHaveTextContent('National B, B-3, no attempts, no reference');
    expect(dialog).toHaveTextContent('With them go 6 attempts with their cues and differences, and 2 references.');
    expect(dialog).toHaveTextContent('The catalogue entries stay. You can add the exercises again from Add exercise. You cannot undo it.');
    expect(within(dialog).getByRole('checkbox', { name: 'Also clean up the raw captures that nothing uses afterwards' })).toBeChecked();
    const before = api.calls.filter(call => `${call.method} ${call.path}` === 'GET /api/exercises').length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete 2 exercises' }));
    await waitFor(() => expect(api.called('POST /api/exercises/remove')).toBe(true));
    const body = api.calls.find(call => call.path === '/api/exercises/remove')!.body as { ids: string[]; cleanup: boolean };
    expect({ ids: [...body.ids].sort(), cleanup: body.cleanup }).toEqual({ ids: [RACING.id, BASICS.id].sort(), cleanup: true });
    await waitFor(() => expect(api.calls.filter(call => `${call.method} ${call.path}` === 'GET /api/exercises').length).toBeGreaterThan(before));
    expect(maybeEl('.selection-bar')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('gt7.currentExercise.user-1')).toBeNull();
  });

  it('no_delete_button_ends_with_an_ellipsis', async () => {
    homeApi();
    renderApp();
    const mine = await findSection(/My exercises/);
    await userEvent.click(within(mine).getByRole('button', { name: 'Select' }));
    await userEvent.click(el('input', elWith('.exercise-row', 'Cornering Basics 1', mine)));
    for (const button of screen.getAllByRole('button')) expect(button.textContent).not.toMatch(/…$/);
  });

  it('quick_select_without_history', async () => {
    homeApi();
    renderApp();
    const mine = await findSection(/My exercises/);
    await userEvent.click(within(mine).getByRole('button', { name: 'Select' }));
    await userEvent.click(within(mine).getByRole('button', { name: 'Without history (1)' }));
    expect(el('input', elWith('.exercise-row', 'Cornering Basics 1', mine))).toBeChecked();
    expect(el('input', elWith('.exercise-row', 'Racing Line: Intermediate', mine))).not.toBeChecked();
    await userEvent.click(within(mine).getByRole('button', { name: 'All (2)' }));
    expect(el('.selection-bar')).toHaveTextContent('2 selected');
    await userEvent.click(within(mine).getByRole('button', { name: 'None' }));
    expect(screen.getByRole('button', { name: 'Delete 0 exercises' })).toBeDisabled();
  });

  it('remove_one_exercise_lists_what_goes', async () => {
    setViewportWidth(390);
    const api = homeApi().on('POST /api/exercises/remove', { exercises: 1, attempts: 6, references: 2, cleanup: null });
    renderApp();
    const mine = await findSection(/My exercises/);
    await userEvent.click(within(mine).getByRole('button', { name: 'Select' }));
    await userEvent.click(el('input', elWith('.exercise-row', 'Yangwang, EXP-1', mine)));
    await userEvent.click(screen.getByRole('button', { name: 'Delete 1 exercise' }));
    const dialog = dialogOf('Delete Yangwang, EXP-1?');
    expect(dialog).toHaveTextContent('The exercise goes, with everything recorded for it:');
    expect(dialog).toHaveTextContent('6 attempts, with their cues and differences');
    expect(dialog).toHaveTextContent('2 references, the active one too');
    expect(dialog).toHaveTextContent('your best time 0:26.900');
    expect(dialog).toHaveTextContent('Yangwang, EXP-1 is your current exercise. The Drive button and Continue move to another exercise.');
    expect(dialog).toHaveTextContent('The catalogue entry stays. You can add the exercise again from Add exercise. You cannot undo it.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete 1 exercise' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Delete 1 exercise' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete exercise' }));
    await waitFor(() => expect(api.called('POST /api/exercises/remove')).toBe(true));
    expect(api.calls.find(call => call.path === '/api/exercises/remove')!.body).toEqual({ ids: [RACING.id], cleanup: true });
  });

  it('remove_one_exercise_without_history_has_no_cleanup_box', async () => {
    homeApi();
    renderApp();
    const mine = await findSection(/My exercises/);
    await userEvent.click(within(mine).getByRole('button', { name: 'Select' }));
    await userEvent.click(el('input', elWith('.exercise-row', 'Cornering Basics 1', mine)));
    await userEvent.click(screen.getByRole('button', { name: 'Delete 1 exercise' }));
    const dialog = dialogOf('Delete National B, B-3?');
    expect(dialog).toHaveTextContent('It has no attempts and no reference yet.');
    expect(dialog).not.toHaveTextContent('is your current exercise');
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
  });

  it('remove_busy_shows_message', async () => {
    homeApi().on('POST /api/exercises/remove', { status: 409, body: { code: 'busy' } });
    renderApp();
    const mine = await findSection(/My exercises/);
    await userEvent.click(within(mine).getByRole('button', { name: 'Select' }));
    await userEvent.click(el('input', elWith('.exercise-row', 'Cornering Basics 1', mine)));
    await userEvent.click(screen.getByRole('button', { name: 'Delete 1 exercise' }));
    const dialog = screen.getByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete exercise' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Stop the training or the recording first.');
  });
});
