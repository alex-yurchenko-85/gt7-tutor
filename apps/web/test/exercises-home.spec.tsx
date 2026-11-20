import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Exercise, Progress } from '@gt7/contracts';
import { catalogueEntry, exercise, exerciseApi, rememberExercise } from './fixtures.ts';
import { liveState, renderApp, setViewportWidth } from './support.tsx';

const RACING = exercise({
  id: 'e0000000-0000-4000-8000-000000000001',
  catalogueId: 'brand-yangwang-racing-lines',
  name: 'Racing Line: Intermediate',
  family: 'Brand Central',
  step: 2,
  status: 'practising',
  completeAttempts: 2,
  attemptCount: 6,
  referenceCount: 2,
  bestMs: 26900,
  nextMedal: { medal: 'bronze', targetMs: 26000, gapMs: 900 },
  targets: { bronzeMs: 26000, silverMs: 25500, goldMs: 25000 }
});

const BASICS = exercise({
  id: 'e0000000-0000-4000-8000-000000000002',
  catalogueId: 'licence-b-3',
  name: 'Cornering Basics 1',
  family: 'Licence',
  step: 1,
  status: 'new',
  activeReferenceId: null,
  createdAt: '2026-11-15T10:00:00.000Z'
});

const PROGRESS: Progress = {
  collections: [
    { family: 'Brand Central', collection: 'Yangwang', counts: { new: 0, ready: 0, practising: 1, bronze: 0, silver: 0, gold: 0 } },
    { family: 'Licence', collection: 'National B', counts: { new: 2, ready: 1, practising: 0, bronze: 1, silver: 1, gold: 0 } }
  ],
  exercises: [
    { id: 'e0000000-0000-4000-8000-000000000001', name: RACING.name, family: 'Brand Central', collection: 'Yangwang', status: 'practising', bestMs: 27100, bestByDay: [] },
    { id: 'e0000000-0000-4000-8000-000000000002', name: BASICS.name, family: 'Licence', collection: 'National B', status: 'new', bestMs: null, bestByDay: [] }
  ]
};

const CATALOGUE = [
  catalogueEntry({ id: 'brand-yangwang-racing-lines', family: 'Brand Central', collection: 'Yangwang', code: 'EXP-1', name: RACING.name, track: 'SUGO', car: "Yangwang U9 '24" }),
  catalogueEntry({ id: 'licence-b-3', family: 'Licence', collection: 'National B', code: 'B-3', name: BASICS.name, track: 'Alsace - Village', car: null })
];

function homeApi(exercises: Exercise[] = [RACING, BASICS], ps5Ip: string | null = '192.0.2.10') {
  rememberExercise('e0000000-0000-4000-8000-000000000001');
  return exerciseApi(RACING)
    .on('GET /api/exercises', exercises)
    .on('GET /api/progress', PROGRESS)
    .on('GET /api/catalogue', CATALOGUE)
    .on('GET /api/settings', { ps5Ip, gameVersion: '1.65' })
    .install();
}

describe('exercises home', () => {
  it('home_shows_continue_card_for_current_exercise', async () => {
    setViewportWidth(1440);
    homeApi();
    renderApp();
    const card = await screen.findByRole('region', { name: 'Racing Line: Intermediate' });
    expect(card).toHaveTextContent('Continue');
    expect(card).toHaveTextContent('0:26.900your best, from the game');
    expect(card).not.toHaveTextContent('measured');
    expect(card).toHaveTextContent('0.90 s');
    expect(card).toHaveTextContent('to bronze, 0:26.000');
    expect(within(card).getByRole('list', { name: 'Three steps' }).querySelector('[aria-current="step"]')).toHaveTextContent('Attempts');
    expect(within(card).getByRole('link', { name: 'Start an attempt' })).toHaveAttribute('href', '/drive');
    expect(within(card).getByRole('link', { name: 'Open the exercise' })).toHaveAttribute('href', '/exercises/e0000000-0000-4000-8000-000000000001');
  });

  it('home_has_no_attempt_mode_text', async () => {
    setViewportWidth(1440);
    homeApi();
    renderApp();
    await screen.findByRole('link', { name: 'Start an attempt' });
    expect(document.body.textContent).not.toMatch(/baseline|guided|without voice|No device plays the voice/i);
  });

  it('home_lists_exercises_grouped_by_family', async () => {
    setViewportWidth(1440);
    homeApi();
    renderApp();
    const mine = await screen.findByRole('region', { name: /My exercises/ });
    const licence = within(mine).getByRole('group', { name: 'Licence' });
    const row = within(licence).getByRole('link', { name: /Cornering Basics 1/ });
    expect(row).toHaveAttribute('href', '/exercises/e0000000-0000-4000-8000-000000000002');
    expect(row).toHaveTextContent('National B, B-3');
    expect(row).toHaveTextContent('New');
    expect(row).toHaveTextContent('Next: record the reference');
    const brand = within(mine).getByRole('group', { name: 'Brand Central' });
    const racing = within(brand).getByRole('link', { name: /Racing Line: Intermediate/ });
    expect(racing).toHaveTextContent('0:26.900');
    expect(racing).toHaveTextContent('Next: attempt');
    expect(racing).toHaveTextContent('SUGO');
  });

  it('home_filter_by_family', async () => {
    setViewportWidth(1440);
    homeApi();
    renderApp();
    const mine = await screen.findByRole('region', { name: /My exercises/ });
    const filter = within(mine).getByRole('group', { name: 'Filter' });
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
    expect(await screen.findByRole('link', { name: 'Add exercise' })).toHaveAttribute('href', '/exercises/add');
  });

  it('home_without_console_shows_get_ready', async () => {
    setViewportWidth(1440);
    homeApi([RACING, BASICS], null);
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'Get ready to train' })).toBeInTheDocument();
    expect(screen.getByLabelText('PS5 address')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /My exercises/ })).toBeNull();
  });

  it('home_without_exercise_shows_get_ready', async () => {
    setViewportWidth(1440);
    homeApi([]);
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'Get ready to train' })).toBeInTheDocument();
  });

  it('home_redirects_to_drive_when_armed', async () => {
    setViewportWidth(1440);
    homeApi();
    const view = renderApp();
    await screen.findByRole('region', { name: /My exercises/ });
    await waitFor(() => view.sockets.latest);
    act(() => {
      view.sockets.latest.open();
      view.sockets.latest.receive({ type: 'state', state: liveState({ mode: 'armed', exerciseId: 'e0000000-0000-4000-8000-000000000001', connection: 'connected' }) });
    });
    await waitFor(() => expect(window.location.pathname).toBe('/drive'));
    window.history.back();
  });

  it('home_shows_collection_counts', async () => {
    setViewportWidth(1440);
    homeApi();
    renderApp();
    const table = await screen.findByRole('table', { name: 'Collections' });
    expect(screen.getByText('Your exercises by status. Medals use the time from the game.')).toBeInTheDocument();
    const licence = within(table).getByRole('row', { name: /Licence, National B/ });
    expect(within(licence).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['Licence, National B', '2', '1', '2']);
  });

  it('home_hides_collections_on_phone', async () => {
    setViewportWidth(390);
    homeApi();
    renderApp();
    await screen.findByRole('region', { name: /My exercises/ });
    expect(screen.queryByRole('table', { name: 'Collections' })).toBeNull();
  });

  it('select_and_remove_exercises', async () => {
    setViewportWidth(1440);
    const api = homeApi().on('POST /api/exercises/remove', { exercises: 2, attempts: 6, references: 2, cleanup: null });
    renderApp();
    const mine = await screen.findByRole('region', { name: /My exercises/ });
    await userEvent.click(within(mine).getByRole('button', { name: 'Select' }));
    const racing = within(mine).getByRole('checkbox', { name: 'Select Racing Line: Intermediate' });
    expect(racing.closest('.exercise-row')).toHaveTextContent('6 attempts, 2 references');
    expect(within(mine).getByRole('checkbox', { name: 'Select Cornering Basics 1' }).closest('.exercise-row')).toHaveTextContent('no attempts, no reference');
    expect(within(mine).queryByRole('link', { name: /Racing Line/ })).toBeNull();
    await userEvent.click(racing);
    await userEvent.click(within(mine).getByRole('checkbox', { name: 'Select Cornering Basics 1' }));
    const bar = screen.getByRole('region', { name: 'Selection' });
    expect(bar).toHaveTextContent('2 selected');
    await userEvent.click(within(bar).getByRole('button', { name: 'Remove 2 exercises…' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Remove 2 exercises?' });
    expect(dialog).toHaveTextContent('Racing Line: Intermediate, 6 attempts, 2 references');
    expect(dialog).toHaveTextContent('Cornering Basics 1, no attempts, no reference');
    expect(dialog).toHaveTextContent('With them go 6 attempts with their cues and differences, and 2 references.');
    expect(dialog).toHaveTextContent('The catalogue entries stay. You can add the exercises again from Add exercise. You cannot undo the removal.');
    expect(within(dialog).getByRole('checkbox', { name: 'Also clean up the raw captures that nothing uses afterwards' })).toBeChecked();
    const before = api.calls.filter(call => `${call.method} ${call.path}` === 'GET /api/exercises').length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove 2 exercises' }));
    await waitFor(() => expect(api.called('POST /api/exercises/remove')).toBe(true));
    const body = api.calls.find(call => call.path === '/api/exercises/remove')!.body as { ids: string[]; cleanup: boolean };
    expect({ ids: [...body.ids].sort(), cleanup: body.cleanup }).toEqual({ ids: [RACING.id, BASICS.id].sort(), cleanup: true });
    await waitFor(() => expect(api.calls.filter(call => `${call.method} ${call.path}` === 'GET /api/exercises').length).toBeGreaterThan(before));
    expect(screen.queryByRole('region', { name: 'Selection' })).not.toBeInTheDocument();
    expect(window.localStorage.getItem('gt7.currentExercise.user-1')).toBeNull();
  });

  it('quick_select_without_history', async () => {
    setViewportWidth(1440);
    homeApi();
    renderApp();
    const mine = await screen.findByRole('region', { name: /My exercises/ });
    await userEvent.click(within(mine).getByRole('button', { name: 'Select' }));
    await userEvent.click(within(mine).getByRole('button', { name: 'Without history (1)' }));
    expect(within(mine).getByRole('checkbox', { name: 'Select Cornering Basics 1' })).toBeChecked();
    expect(within(mine).getByRole('checkbox', { name: 'Select Racing Line: Intermediate' })).not.toBeChecked();
    await userEvent.click(within(mine).getByRole('button', { name: 'All (2)' }));
    expect(screen.getByRole('region', { name: 'Selection' })).toHaveTextContent('2 selected');
    await userEvent.click(within(mine).getByRole('button', { name: 'None' }));
    expect(screen.getByRole('button', { name: 'Remove 0 exercises…' })).toBeDisabled();
  });

  it('remove_one_exercise_lists_what_goes', async () => {
    setViewportWidth(390);
    const api = homeApi().on('POST /api/exercises/remove', { exercises: 1, attempts: 6, references: 2, cleanup: null });
    renderApp();
    const mine = await screen.findByRole('region', { name: /My exercises/ });
    await userEvent.click(within(mine).getByRole('button', { name: 'Select' }));
    await userEvent.click(within(mine).getByRole('checkbox', { name: 'Select Racing Line: Intermediate' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove 1 exercise…' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Remove Racing Line: Intermediate?' });
    expect(dialog).toHaveTextContent('The exercise goes, with everything recorded for it:');
    expect(dialog).toHaveTextContent('6 attempts, with their cues and differences');
    expect(dialog).toHaveTextContent('2 references, the active one too');
    expect(dialog).toHaveTextContent('your best time 0:26.900');
    expect(dialog).toHaveTextContent('Racing Line: Intermediate is your current exercise. The Drive button and Continue move to another exercise.');
    expect(dialog).toHaveTextContent('The catalogue entry stays. You can add the exercise again from Add exercise. You cannot undo the removal.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove 1 exercise…' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Remove 1 exercise…' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove exercise' }));
    await waitFor(() => expect(api.called('POST /api/exercises/remove')).toBe(true));
    expect(api.calls.find(call => call.path === '/api/exercises/remove')!.body).toEqual({ ids: [RACING.id], cleanup: true });
  });

  it('remove_one_exercise_without_history_has_no_cleanup_box', async () => {
    setViewportWidth(1440);
    homeApi();
    renderApp();
    const mine = await screen.findByRole('region', { name: /My exercises/ });
    await userEvent.click(within(mine).getByRole('button', { name: 'Select' }));
    await userEvent.click(within(mine).getByRole('checkbox', { name: 'Select Cornering Basics 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove 1 exercise…' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Remove Cornering Basics 1?' });
    expect(dialog).toHaveTextContent('It has no attempts and no reference yet.');
    expect(dialog).not.toHaveTextContent('is your current exercise');
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
  });

  it('remove_busy_shows_message', async () => {
    setViewportWidth(1440);
    homeApi().on('POST /api/exercises/remove', { status: 409, body: { code: 'busy', reason: 'Busy.' } });
    renderApp();
    const mine = await screen.findByRole('region', { name: /My exercises/ });
    await userEvent.click(within(mine).getByRole('button', { name: 'Select' }));
    await userEvent.click(within(mine).getByRole('checkbox', { name: 'Select Cornering Basics 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove 1 exercise…' }));
    const dialog = screen.getByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove exercise' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Stop the training or the recording first.');
  });
});
