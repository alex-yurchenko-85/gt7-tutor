import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Exercise } from '@gt7/contracts';
import { startLanguage, t } from '../src/app/i18n.ts';
import { catalogueEntry, exercise, exerciseApi, rememberExercise, TRACE, EXERCISE_ID } from './fixtures.ts';
import { renderApp, setViewportWidth, USER, findEl, maybeEl, maybeSection, el, type ApiStub } from './support.tsx';

function band(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.exercise-times');
}

describe('exercise page', () => {
  it('opens_on_cues_without_an_overview_tab', async () => {
    exerciseApi(exercise()).install();
    rememberExercise();
    renderApp({ path: `/exercises/${EXERCISE_ID}` });
    const tabs = await findEl('nav.exercise-tabs');
    expect(within(tabs).getAllByRole('link').map(link => link.textContent)).toEqual(['Cues', 'References', 'Attempts']);
    expect(within(tabs).getByRole('link', { name: 'Cues' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: 'Cues' })).toHaveAttribute('href', `/exercises/${EXERCISE_ID}/cues`);
    expect(within(tabs).queryByRole('link', { name: 'Overview' })).toBeNull();
    expect(maybeSection(/^Next:/)).toBeNull();
  });

  it('tabs_have_no_drive_tab', async () => {
    exerciseApi(exercise({ attemptCount: 6, completeAttempts: 4 })).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    const tabs = await findEl('nav.exercise-tabs');
    expect(within(tabs).queryByRole('link', { name: 'Drive' })).toBeNull();
    expect(tabs.querySelector('.drive-tab')).toBeNull();
    expect(within(tabs).getByRole('link', { name: 'Attempts' })).toHaveTextContent(/^Attempts$/);
    expect(within(tabs).getByRole('link', { name: 'Attempts' })).toHaveAttribute('aria-current', 'page');
  });

  it('exercise_header_is_the_same_on_every_tab', async () => {
    const sections: [string, string | null][] = [
      [`/exercises/${EXERCISE_ID}`, null],
      [`/exercises/${EXERCISE_ID}/cues`, null],
      [`/exercises/${EXERCISE_ID}/references`, 'Reference history'],
      [`/exercises/${EXERCISE_ID}/attempts`, null]
    ];
    for (const [path, section] of sections) {
      exerciseApi(exercise()).install();
      rememberExercise();
      const view = renderApp({ path });
      const navigation = await findEl('nav.exercise-tabs');
      const title = screen.getByRole('heading', { level: 1 });
      expect(title, path).toHaveTextContent('Yangwang, EXP-1');
      const times = await waitFor(() => band() ?? Promise.reject(new Error('no band')));
      expect(title.compareDocumentPosition(times) & Node.DOCUMENT_POSITION_FOLLOWING, path).toBeTruthy();
      expect(times.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING, path).toBeTruthy();
      if (section) {
        const heading = await screen.findByRole('heading', { level: 2, name: section });
        expect(navigation.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING, path).toBeTruthy();
      }
      view.unmount();
    }
  });

  it('band_shows_the_target_and_its_gap_before_the_reference', async () => {
    exerciseApi(exercise({ bestMs: 24112, targetMs: 23800, targetGapMs: 312 }))
      .on('GET /api/references/ref-demo/path', { ...TRACE, timeMs: 23480 })
      .install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    await waitFor(() => expect(band()).toHaveTextContent('0:23.480'));
    const cells = [...band()!.children].map(cell => cell.textContent);
    expect(cells).toEqual(['0:24.112your best', '0:23.800targetedit', '+0.31 sgap to the target', '0:23.480reference', '+0.63 sgap to the reference']);
    expect(within(band()!).getByText('+0.31 s').parentElement).toHaveClass('gap-slower');
    expect(within(band()!).getByRole('button', { name: 'edit' })).toBeVisible();
  });

  it('band_without_a_target_shows_a_dash_and_no_target_gap', async () => {
    exerciseApi(exercise({ bestMs: 24112 })).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    await waitFor(() => expect(band()).toHaveTextContent('reference'));
    expect(el('.target-time', band()!)).toHaveTextContent(/^–targetedit$/);
    expect(band()).not.toHaveTextContent('gap to the target');
  });

  it('band_shows_only_the_target_of_a_new_exercise', async () => {
    exerciseApi(exercise({ activeReferenceId: null, referenceCount: 0, targetMs: 13100 })).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}` });
    await waitFor(() => expect(band()).toHaveTextContent(/^0:13\.100targetedit$/));
    expect(maybeEl('nav.exercise-tabs')).toBeNull();
    expect(screen.getByRole('link', { name: 'Record the reference' })).toBeInTheDocument();
  });

  it('band_of_a_new_exercise_without_a_target_lets_the_player_set_one', async () => {
    const fresh = exercise({ activeReferenceId: null, referenceCount: 0, attemptCount: 0, targetMs: null, bestMs: null });
    const api = exerciseApi(fresh)
      .on(`PATCH /api/exercises/${fresh.id}`, (body: { targetMs: number | null }) => ({ ...fresh, targetMs: body.targetMs }))
      .install();
    renderApp({ path: `/exercises/${EXERCISE_ID}` });
    await waitFor(() => expect(band()).toHaveTextContent(/^–targetedit$/));
    expect(maybeEl('nav.exercise-tabs')).toBeNull();
    const user = userEvent.setup();
    await user.click(within(band()!).getByRole('button', { name: 'edit' }));
    await user.type(el('.target-time input'), '23.8{Enter}');
    await waitFor(() => expect(el('.target-time b')).toHaveTextContent('0:23.800'));
    expect(api.calls.filter(call => call.method === 'PATCH').map(call => call.body)).toEqual([{ targetMs: 23800 }]);
    expect(maybeEl('nav.exercise-tabs')).toBeNull();
  });

  it('band_shows_the_three_times_from_the_game', async () => {
    exerciseApi(exercise({ bestMs: 26500, completeAttempts: 4 }))
      .on('GET /api/references/ref-demo/path', { ...TRACE, timeMs: 25470 })
      .install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    await waitFor(() => expect(band()).toHaveTextContent('+1.03 s'));
    const times = band()!;
    expect(times).toHaveTextContent('0:26.500your best');
    expect(times).toHaveTextContent('0:25.470reference');
    expect(times).toHaveTextContent('gap to the reference');
    expect(within(times).getByText('+1.03 s').parentElement).toHaveClass('gap-slower');
    expect(times).not.toHaveTextContent('Next');
  });

  it('band_shows_what_exists_and_always_the_target', async () => {
    exerciseApi(exercise({ bestMs: 26500, activeReferenceId: null })).install();
    const first = renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    await waitFor(() => expect(band()).toHaveTextContent('0:26.500your best'));
    expect(band()).not.toHaveTextContent('reference');
    first.unmount();
    exerciseApi(exercise({ bestMs: null, activeReferenceId: null, referenceCount: 1 })).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    await findEl('nav.exercise-tabs');
    expect(band()).toHaveTextContent(/^–targetedit$/);
  });

  it('visiting_exercise_remembers_it', async () => {
    setViewportWidth(390);
    exerciseApi(exercise()).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}` });
    await screen.findByRole('heading', { level: 1, name: 'Yangwang, EXP-1' });
    await waitFor(() => expect(window.localStorage.getItem(`gt7.currentExercise.${USER.id}`)).toBe(EXERCISE_ID));
  });

  it('exercise_header_has_a_breadcrumb', async () => {
    exerciseApi(exercise({ attemptCount: 6, completeAttempts: 4 })).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}` });
    const breadcrumb = await findEl('nav.breadcrumb');
    expect(within(breadcrumb).getByRole('link', { name: 'Exercises' })).toHaveAttribute('href', '/exercises');
    expect(breadcrumb).toHaveTextContent('Exercises / Yangwang, EXP-1');
    expect(within(breadcrumb).getAllByRole('link')).toHaveLength(1);
  });
});

describe('exercise header', () => {
  it('own_exercise_keeps_its_name_and_shows_the_family_and_its_collection', async () => {
    exerciseApi(exercise({ catalogueId: null, family: 'Time Trial', name: 'Tsukuba lap', collection: null, code: null })).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}` });
    expect(await screen.findByRole('heading', { level: 1, name: 'Tsukuba lap' })).toBeInTheDocument();
    expect(await screen.findByText('Time Trial · Own exercises', { selector: '.exercise-where' })).toBeInTheDocument();
  });

  it('own_exercise_line_is_translated', async () => {
    exerciseApi(exercise({ catalogueId: null, family: 'Time Trial', name: 'Tsukuba lap', collection: null, code: null })).install();
    startLanguage('?lang=xx', null);
    try {
      renderApp({ path: `/exercises/${EXERCISE_ID}` });
      expect(await findEl('.exercise-where')).toHaveTextContent(`Time Trial · ${t('exercises.own-collection')}`);
      expect(el('.exercise-where')).not.toHaveTextContent('Own exercises');
    } finally {
      startLanguage('', null);
    }
  });

  it('licence_exercise_shows_its_code_as_the_title_and_its_name_before_the_track', async () => {
    exerciseApi(exercise({ catalogueId: 'licence-b-5', family: 'Licence', name: 'Cornering Basics 3', collection: 'National B', code: 'B-5' }))
      .on('GET /api/catalogue', [catalogueEntry({ id: 'licence-b-5', code: 'B-5', track: 'Tsukuba Circuit', car: "Autobianchi A112 Abarth '85" })])
      .install();
    renderApp({ path: `/exercises/${EXERCISE_ID}` });
    expect(await screen.findByRole('heading', { level: 1, name: 'National B, B-5' })).toBeInTheDocument();
    expect(el('nav.breadcrumb')).toHaveTextContent('Exercises / National B, B-5');
    expect(await screen.findByText('Licence · Cornering Basics 3 · Tsukuba Circuit', { selector: '.exercise-where' })).toBeInTheDocument();
  });

  it('licence_exercise_shows_its_name_in_the_line_before_the_catalogue_loads', async () => {
    exerciseApi(exercise({ catalogueId: 'licence-b-5', family: 'Licence', name: 'Cornering Basics 3', collection: 'National B', code: 'B-5' }))
      .on('GET /api/catalogue', () => new Promise(() => undefined))
      .install();
    renderApp({ path: `/exercises/${EXERCISE_ID}` });
    expect(await screen.findByRole('heading', { level: 1, name: 'National B, B-5' })).toBeInTheDocument();
    expect(el('.exercise-where')).toHaveTextContent('Licence · Cornering Basics 3');
  });
});

describe('target edit', () => {
  const TARGET = exercise({ bestMs: 24112, targetMs: 23800, targetGapMs: 312 });

  function targetApi(start: Exercise = TARGET, delayMs = 0) {
    let current = start;
    const api = exerciseApi(start)
      .on(`GET /api/exercises/${start.id}`, () => current)
      .on(`PATCH /api/exercises/${start.id}`, async (body: { targetMs: number | null }) => {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        current = { ...current, targetMs: body.targetMs, targetGapMs: body.targetMs === null || current.bestMs === null ? null : Math.max(current.bestMs - body.targetMs, 0) || null };
        return current;
      })
      .install();
    return api;
  }

  function patches(api: ApiStub): unknown[] {
    return api.calls.filter(call => call.method === 'PATCH').map(call => call.body);
  }

  async function openEdit() {
    const user = userEvent.setup();
    const edit = await waitFor(() => within(el('.target-time')).getByRole('button', { name: 'edit' }));
    await user.click(edit);
    const field = el('.target-time input') as HTMLInputElement;
    return { user, edit, field };
  }

  it('edit_opens_a_focused_field_in_place_and_keeps_the_edit_place', async () => {
    targetApi();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    const { edit, field } = await openEdit();
    expect(field).toHaveFocus();
    expect(field).toHaveValue('0:23.800');
    expect(field.selectionStart).toBe(8);
    expect(field.selectionEnd).toBe(8);
    expect(edit).toHaveStyle({ visibility: 'hidden' });
    expect(el('.target-time b')).toHaveTextContent('0:23.800');
  });

  it('enter_saves_the_new_target', async () => {
    const api = targetApi();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    const { user, field } = await openEdit();
    await user.clear(field);
    await user.type(field, '0:23.5{Enter}');
    await waitFor(() => expect(el('.target-time b')).toHaveTextContent('0:23.500'));
    expect(patches(api)).toEqual([{ targetMs: 23500 }]);
    expect(maybeEl('.target-time input')).toBeNull();
    expect(band()).toHaveTextContent('+0.61 sgap to the target');
  });

  it('leaving_the_field_saves', async () => {
    const api = targetApi();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    const { user, field } = await openEdit();
    await user.clear(field);
    await user.type(field, '24');
    await user.click(el('h1'));
    await waitFor(() => expect(patches(api)).toEqual([{ targetMs: 24000 }]));
  });

  it('escape_cancels', async () => {
    const api = targetApi();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    const { user, field } = await openEdit();
    await user.clear(field);
    await user.type(field, '20{Escape}');
    expect(maybeEl('.target-time input')).toBeNull();
    expect(el('.target-time b')).toHaveTextContent('0:23.800');
    expect(patches(api)).toEqual([]);
  });

  it('empty_field_removes_the_target', async () => {
    const api = targetApi();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    const { user, field } = await openEdit();
    await user.clear(field);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(el('.target-time b')).toHaveTextContent('–'));
    expect(patches(api)).toEqual([{ targetMs: null }]);
    expect(band()).not.toHaveTextContent('gap to the target');
  });

  it('text_that_is_not_a_time_keeps_the_old_target', async () => {
    const api = targetApi();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    const { user, field } = await openEdit();
    await user.clear(field);
    await user.type(field, 'abc{Enter}');
    expect(maybeEl('.target-time input')).toBeNull();
    expect(el('.target-time b')).toHaveTextContent('0:23.800');
    expect(patches(api)).toEqual([]);
  });

  it('a_click_on_a_tab_saves_before_the_next_page_reads_the_exercise', async () => {
    const api = targetApi(TARGET, 50);
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    const { user, field } = await openEdit();
    await user.clear(field);
    await user.type(field, '23.5');
    await user.click(within(el('nav.exercise-tabs')).getByRole('link', { name: 'Cues' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/exercises/${EXERCISE_ID}/cues`));
    await waitFor(() => expect(el('.target-time b')).toHaveTextContent('0:23.500'));
    expect(patches(api)).toEqual([{ targetMs: 23500 }]);
    const order = api.calls.map(call => `${call.method} ${call.path}`);
    expect(order.lastIndexOf(`GET /api/exercises/${EXERCISE_ID}`)).toBeGreaterThan(order.indexOf(`PATCH /api/exercises/${EXERCISE_ID}`));
  });
});
