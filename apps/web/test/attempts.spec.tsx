import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EXERCISE_ID, exercise, exerciseApi } from './fixtures.ts';
import { ATTEMPT_LIST, attemptSummary, ATTEMPT_ID } from './review-fixtures.ts';
import { renderApp, sendLiveState, setViewportWidth } from './support.tsx';

describe('attempts', () => {
  const ATTEMPTS_PATH = `/exercises/${EXERCISE_ID}/attempts`;
  const LIST_ROUTE = `GET /api/exercises/${EXERCISE_ID}/attempts`;

  it('attempts_group_by_day_and_mark_best', async () => {
    exerciseApi(exercise({ completeAttempts: 2, bestMs: 26800 })).on(`GET /api/exercises/${EXERCISE_ID}/attempts`, ATTEMPT_LIST).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    const days = await screen.findAllByRole('table', { name: /^Attempts on/ });
    expect(days.map(day => day.getAttribute('aria-label'))).toEqual(['Attempts on 17 November', 'Attempts on 16 November']);
    const best = within(days[0]!).getByRole('row', { name: /Attempt 2/ });
    expect(best).toHaveTextContent('0:26.800');
    expect(within(best).getByText('best')).toBeInTheDocument();
    const first = within(days[1]!).getByRole('row', { name: /Attempt 1/ });
    expect(first).toHaveTextContent('+0.30 s');
    expect(first).toHaveTextContent('332 m. Braked 14 m earlier');
    expect(within(first).queryByText('best')).not.toBeInTheDocument();
    expect(within(first).getByRole('link', { name: 'Review attempt 1' })).toHaveAttribute('href', `/attempts/${ATTEMPT_ID}/review`);
  });

  it('game_time_shows_thousandths_without_a_label', async () => {
    const timed = { ...ATTEMPT_LIST.days[0]!.attempts[1]!, timeMs: 23429 };
    const list = { ...ATTEMPT_LIST, days: [{ ...ATTEMPT_LIST.days[0]!, attempts: [timed] }] };
    exerciseApi().on(`GET /api/exercises/${EXERCISE_ID}/attempts`, list).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    const row = await screen.findByRole('row', { name: new RegExp(`Attempt ${timed.number}`) });
    expect(row).toHaveTextContent('0:23.429');
    expect(row).not.toHaveTextContent('official');
    expect(row).not.toHaveTextContent('measured');
  });

  it('aborted_attempt_has_no_time', async () => {
    setViewportWidth(390);
    exerciseApi().on(`GET /api/exercises/${EXERCISE_ID}/attempts`, ATTEMPT_LIST).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    const row = await screen.findByRole('row', { name: /Attempt 3/ });
    expect(row).toHaveTextContent('No time');
    expect(row).toHaveTextContent('aborted, training stopped');
    expect(row).not.toHaveTextContent(/\d:\d\d\.\d\d/);
  });

  it('recurring_shows_count_of_attempts', async () => {
    exerciseApi(exercise({ completeAttempts: 8 }))
      .on(`GET /api/exercises/${EXERCISE_ID}/attempts`, ATTEMPT_LIST)
      .on(`GET /api/exercises/${EXERCISE_ID}/recurring`, [{ kind: 'brake-early', eventKey: 'brake@412', sM: 412, size: 15, unit: 'm', count: 6, of: 8, medianSize: 14 }])
      .install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    const section = await screen.findByRole('region', { name: 'Recurring differences' });
    const item = await within(section).findByRole('listitem');
    expect(item).toHaveTextContent('Braked early at 412 m, median 14 m');
    expect(item).toHaveTextContent('6 of 8');
    expect(section).toHaveTextContent('At the same place in at least half of your last 8 complete attempts.');
  });

  it('fewer_than_three_attempts_says_so', async () => {
    exerciseApi(exercise({ completeAttempts: 2 })).on(`GET /api/exercises/${EXERCISE_ID}/attempts`, ATTEMPT_LIST).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    const section = await screen.findByRole('region', { name: 'Recurring differences' });
    expect(within(section).getByText(/at least three complete attempts\. You have 2\./)).toBeInTheDocument();
  });

  it('aborted_reasons_are_plain_words', async () => {
    const reasons = ['left-track', 'restart', 'manual', 'silence', 'player-session-ended', 'loading', 'car-changed', 'discontinuity'];
    const attempts = reasons.map((reason, index) =>
      attemptSummary({ id: `a0000000-0000-4000-8000-00000000001${index}`, number: index + 1, completion: 'aborted', reason, timeMs: null, gapToBestMs: null })
    );
    exerciseApi()
      .on(`GET /api/exercises/${EXERCISE_ID}/attempts`, { bestMs: null, days: [{ date: '2026-11-17', bestMs: null, attempts }] })
      .install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    const table = await screen.findByRole('table', { name: /Attempts on/ });
    expect(within(table).getByRole('columnheader', { name: 'Time from the game' })).toBeInTheDocument();
    const shown = reasons.map((_, index) => within(table).getByRole('row', { name: `Attempt ${index + 1}` }).querySelector('.sub')?.textContent);
    expect(shown).toEqual([
      'aborted, left the track',
      'aborted, restarted',
      'aborted, training stopped',
      'aborted, telemetry stopped',
      'aborted, left the exercise',
      'aborted, game loading',
      'aborted, car changed',
      'aborted, car position jumped'
    ]);
  });

  it('attempts_have_no_voice_comparison_and_no_voice_column', async () => {
    exerciseApi().on(`GET /api/exercises/${EXERCISE_ID}/attempts`, ATTEMPT_LIST).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    await screen.findByRole('row', { name: /Attempt 2/ });
    expect(screen.queryByRole('region', { name: 'Does the voice help?' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Voice' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/with voice|without voice|median/i);
  });

  it('recurring_shows_three_then_more', async () => {
    const recurring = [412, 500, 600, 700, 800].map((sM, index) => ({ kind: 'brake-early', eventKey: `brake@${sM}`, sM, size: 15, unit: 'm', turn: index + 1, count: 6, of: 8, medianSize: 14 }));
    exerciseApi(exercise({ completeAttempts: 8 }))
      .on(`GET /api/exercises/${EXERCISE_ID}/attempts`, ATTEMPT_LIST)
      .on(`GET /api/exercises/${EXERCISE_ID}/recurring`, recurring)
      .install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    const section = await screen.findByRole('region', { name: 'Recurring differences' });
    await within(section).findByText('Braked early at 412 m, median 14 m');
    expect(within(section).getAllByRole('listitem')).toHaveLength(3);
    expect(within(section).getAllByRole('listitem')[0]).toHaveTextContent('T1');
    const more = within(section).getByRole('button', { name: 'Show 2 more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.setup().click(more);
    expect(within(section).getAllByRole('listitem')).toHaveLength(5);
    expect(within(section).getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('largest_difference_shows_its_turn', async () => {
    exerciseApi().on(`GET /api/exercises/${EXERCISE_ID}/attempts`, ATTEMPT_LIST).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    const row = await screen.findByRole('row', { name: /Attempt 1/ });
    expect(within(row).getByText('T1')).toHaveClass('tag');
  });

  it('aborted_attempts_can_be_hidden_and_shown_again', async () => {
    exerciseApi().on(`GET /api/exercises/${EXERCISE_ID}/attempts`, ATTEMPT_LIST).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Hide aborted' }));
    expect(screen.queryByRole('row', { name: /Attempt 3/ })).toBeNull();
    expect(screen.getByRole('row', { name: /Attempt 2/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hide aborted' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show aborted' }));
    expect(screen.getByRole('row', { name: /Attempt 3/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide aborted' })).toBeInTheDocument();
  });

  it('row_opens_the_review_without_a_button', async () => {
    exerciseApi().on(`GET /api/exercises/${EXERCISE_ID}/attempts`, ATTEMPT_LIST).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    const row = await screen.findByRole('row', { name: /Attempt 1/ });
    expect(within(row).getAllByRole('link')).toHaveLength(1);
    expect(within(row).getByRole('link', { name: 'Review attempt 1' })).toHaveClass('row-link');
    expect(row).not.toHaveTextContent(/Review$/);
    expect(row.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('phone_row_shows_the_largest_difference', async () => {
    setViewportWidth(390);
    exerciseApi().on(`GET /api/exercises/${EXERCISE_ID}/attempts`, ATTEMPT_LIST).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    const row = await screen.findByRole('row', { name: /Attempt 1/ });
    expect(row).toHaveTextContent('332 m. Braked 14 m earlier');
    expect(within(row).getByText('T1')).toHaveClass('tag');
    expect(screen.queryByRole('columnheader', { name: 'Largest difference' })).toBeNull();
  });

  it('selecting_row_click_selects_and_does_not_navigate', async () => {
    exerciseApi().on(`GET /api/exercises/${EXERCISE_ID}/attempts`, ATTEMPT_LIST).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select' }));
    const row = screen.getByRole('row', { name: /Attempt 1/ });
    expect(within(row).queryByRole('link')).toBeNull();
    expect(row.querySelector('svg')).toBeNull();
    await user.click(within(row).getByText(/0:\d\d\.\d{3}/));
    expect(within(row).getByRole('checkbox')).toBeChecked();
    await user.click(within(row).getByRole('checkbox'));
    expect(within(row).getByRole('checkbox')).not.toBeChecked();
    await user.click(within(row).getByRole('checkbox'));
    expect(within(row).getByRole('checkbox')).toBeChecked();
    expect(window.location.pathname).toMatch(/\/attempts$/);
  });

  it('selecting_has_no_review_page_hint', async () => {
    exerciseApi().on(`GET /api/exercises/${EXERCISE_ID}/attempts`, ATTEMPT_LIST).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }));
    expect(screen.queryByText(/can also be deleted from its Review page/)).toBeNull();
  });

  it('dialog_says_the_best_stays_when_it_is_unchanged', async () => {
    exerciseApi().on(LIST_ROUTE, ATTEMPT_LIST).install();
    renderApp({ path: ATTEMPTS_PATH });
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select attempt 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete 1 attempt' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Your best stays 0:26.800.');
    expect(dialog).not.toHaveTextContent('→');
  });

  it('dialog_has_no_best_line_without_a_complete_attempt', async () => {
    const aborted = attemptSummary({ completion: 'aborted', reason: 'manual', timeMs: null, gapToBestMs: null });
    exerciseApi()
      .on(LIST_ROUTE, { bestMs: null, days: [{ date: '2026-11-17', bestMs: null, attempts: [aborted] }] })
      .install();
    renderApp({ path: ATTEMPTS_PATH });
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await userEvent.click(screen.getByRole('checkbox', { name: `Select attempt ${aborted.number}` }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete 1 attempt' }));
    expect(within(screen.getByRole('alertdialog')).queryByText(/Your best/)).toBeNull();
  });

  it('selection_marks_only_the_selected_rows', async () => {
    exerciseApi().on(LIST_ROUTE, ATTEMPT_LIST).install();
    renderApp({ path: ATTEMPTS_PATH });
    const user = userEvent.setup();
    const bestBefore = await screen.findByRole('row', { name: /Attempt 2/ });
    expect(bestBefore).toHaveClass('best');
    await user.click(screen.getByRole('button', { name: 'Select' }));
    const best = screen.getByRole('row', { name: /Attempt 2/ });
    expect(best).not.toHaveClass('best');
    expect(within(best).getByText('best')).toBeInTheDocument();
    await user.click(within(best).getByRole('checkbox'));
    expect(best).toHaveClass('picked');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('row', { name: /Attempt 2/ })).toHaveClass('best');
  });

  it('no_delete_button_ends_with_an_ellipsis', async () => {
    exerciseApi().on(LIST_ROUTE, ATTEMPT_LIST).install();
    renderApp({ path: ATTEMPTS_PATH });
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }));
    for (const button of screen.getAllByRole('button')) expect(button.textContent).not.toMatch(/…$/);
  });

  it('attempts_select_and_delete', async () => {
    const api = exerciseApi().on(LIST_ROUTE, ATTEMPT_LIST).on('POST /api/attempts/delete', { deleted: 2 }).install();
    renderApp({ path: ATTEMPTS_PATH });
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select attempt 3' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select attempt 1' }));
    const bar = screen.getByRole('region', { name: 'Selection' });
    expect(bar).toHaveTextContent('2 selected');
    await userEvent.click(within(bar).getByRole('button', { name: 'Delete 2 attempts' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete 2 attempts?' });
    expect(dialog).toHaveTextContent('Attempts 1, 3, with their cues and differences.');
    expect(dialog).toHaveTextContent('The references stay. The raw captures stay until you clean them up in Setup.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete 2 attempts' }));
    await waitFor(() => expect(api.called('POST /api/attempts/delete')).toBe(true));
    const sent = api.calls.find(call => call.path === '/api/attempts/delete')!.body as { ids: string[] };
    expect([...sent.ids].sort()).toEqual([ATTEMPT_ID, 'a0000000-0000-4000-8000-000000000003']);
    await waitFor(() => expect(api.calls.filter(call => `${call.method} ${call.path}` === LIST_ROUTE)).toHaveLength(2));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Selection' })).not.toBeInTheDocument();
  });

  it('delete_dialog_shows_new_best', async () => {
    exerciseApi().on(LIST_ROUTE, ATTEMPT_LIST).install();
    renderApp({ path: ATTEMPTS_PATH });
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select attempt 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete 1 attempt' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete attempt 2?' });
    expect(dialog).toHaveTextContent('Your best: 0:26.800 → 0:27.100');
    expect(within(dialog).getByRole('button', { name: 'Delete attempt' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select attempt 2' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Delete 1 attempt' })).toHaveFocus();
  });

  it('quick_select_aborted', async () => {
    exerciseApi().on(LIST_ROUTE, ATTEMPT_LIST).install();
    renderApp({ path: ATTEMPTS_PATH });
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }));
    const day = screen.getByRole('group', { name: 'Select on 17 November' });
    await userEvent.click(within(day).getByRole('button', { name: 'Aborted (1)' }));
    expect(screen.getByRole('checkbox', { name: 'Select attempt 3' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select attempt 2' })).not.toBeChecked();
    await userEvent.click(within(day).getByRole('button', { name: 'All on this day (2)' }));
    expect(screen.getByRole('region', { name: 'Selection' })).toHaveTextContent('2 selected');
    await userEvent.click(within(day).getByRole('button', { name: 'None' }));
    expect(screen.getByRole('region', { name: 'Selection' })).toHaveTextContent('0 selected');
    expect(screen.getByRole('button', { name: 'Delete 0 attempts' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('checkbox', { name: 'Select attempt 3' })).not.toBeInTheDocument();
  });

  it('quick_select_has_no_without_voice_choice', async () => {
    exerciseApi().on(LIST_ROUTE, ATTEMPT_LIST).install();
    renderApp({ path: ATTEMPTS_PATH });
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }));
    const day = screen.getByRole('group', { name: 'Select on 17 November' });
    expect(within(day).getAllByRole('button').map(button => button.textContent)).toEqual(['Aborted (1)', 'All on this day (2)', 'None']);
  });

  it('busy_conflict_shows_message', async () => {
    exerciseApi()
      .on(LIST_ROUTE, ATTEMPT_LIST)
      .on('POST /api/attempts/delete', { status: 409, body: { code: 'busy' } })
      .install();
    renderApp({ path: ATTEMPTS_PATH });
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select attempt 3' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete 1 attempt' }));
    const dialog = screen.getByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete attempt' }));
    expect(await within(dialog).findByText('Stop the training or the recording first.')).toBeInTheDocument();
  });

  it('delete_stops_the_training_first', async () => {
    const api = exerciseApi().on(LIST_ROUTE, ATTEMPT_LIST).on('POST /api/training/disarm', { status: 201, body: { ok: true } }).on('POST /api/attempts/delete', { deleted: 1 }).install();
    const view = renderApp({ path: ATTEMPTS_PATH });
    await sendLiveState(view, { mode: 'finished', exerciseId: EXERCISE_ID });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select attempt 1' }));
    await user.click(within(screen.getByRole('region', { name: 'Selection' })).getByRole('button', { name: 'Delete 1 attempt' }));
    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() => expect(dialog).toHaveTextContent(`The training of ${exercise().name} is on. It stops when you delete.`));
    await user.click(within(dialog).getByRole('button', { name: 'Stop the training and delete' }));
    await waitFor(() => expect(api.called('POST /api/attempts/delete')).toBe(true));
    expect(api.calls.filter(call => call.method === 'POST').map(call => `${call.method} ${call.path}`).slice(0, 2)).toEqual(['POST /api/training/disarm', 'POST /api/attempts/delete']);
  });

  it('delete_waits_while_an_attempt_runs', async () => {
    exerciseApi().on(LIST_ROUTE, ATTEMPT_LIST).install();
    const view = renderApp({ path: ATTEMPTS_PATH });
    await sendLiveState(view, { mode: 'paused', exerciseId: EXERCISE_ID, attemptNumber: 10 });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select attempt 1' }));
    await user.click(within(screen.getByRole('region', { name: 'Selection' })).getByRole('button', { name: 'Delete 1 attempt' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Attempt 10 runs. Finish it or stop the training first.');
    expect(within(dialog).getByRole('button', { name: 'Delete attempt' })).toBeDisabled();
  });

  it('delete_does_not_happen_when_the_stop_fails', async () => {
    const api = exerciseApi().on(LIST_ROUTE, ATTEMPT_LIST).on('POST /api/training/disarm', { status: 500, body: { code: 'server-error' } }).install();
    const view = renderApp({ path: ATTEMPTS_PATH });
    await sendLiveState(view, { mode: 'armed', exerciseId: EXERCISE_ID });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select attempt 1' }));
    await user.click(within(screen.getByRole('region', { name: 'Selection' })).getByRole('button', { name: 'Delete 1 attempt' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Stop the training and delete' }));
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(api.called('POST /api/attempts/delete')).toBe(false);
  });
});

