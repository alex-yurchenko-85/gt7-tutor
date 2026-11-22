import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { catalogueEntry, exercise, exerciseApi, exerciseAtStep, rememberExercise, TRACE, EXERCISE_ID } from './fixtures.ts';
import { renderApp, setViewportWidth, USER, findEl, maybeSection } from './support.tsx';

function band(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.exercise-times');
}

describe('exercise page', () => {
  it('opens_on_cues_without_an_overview_tab', async () => {
    exerciseApi(exerciseAtStep(3)).install();
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
    exerciseApi(exercise({ step: 3, attemptCount: 6, completeAttempts: 4 })).install();
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
      exerciseApi(exerciseAtStep(3)).install();
      rememberExercise();
      const view = renderApp({ path });
      const navigation = await findEl('nav.exercise-tabs');
      const title = screen.getByRole('heading', { level: 1 });
      expect(title, path).toHaveTextContent('Yangwang Experience / Racing Lines');
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

  it('band_shows_the_three_times_from_the_game', async () => {
    exerciseApi(exercise({ step: 3, bestMs: 26500, completeAttempts: 4 }))
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

  it('band_shows_what_exists_and_is_absent_without_any_time', async () => {
    exerciseApi(exercise({ step: 2, bestMs: 26500, activeReferenceId: null })).install();
    const first = renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    await waitFor(() => expect(band()).toHaveTextContent('0:26.500your best'));
    expect(band()).not.toHaveTextContent('reference');
    first.unmount();
    exerciseApi(exercise({ step: 1, bestMs: null, activeReferenceId: null })).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    await findEl('nav.exercise-tabs');
    expect(band()).toBeNull();
  });

  it('visiting_exercise_remembers_it', async () => {
    setViewportWidth(390);
    exerciseApi(exerciseAtStep(2)).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}` });
    await screen.findByRole('heading', { level: 1, name: 'Yangwang Experience / Racing Lines' });
    await waitFor(() => expect(window.localStorage.getItem(`gt7.currentExercise.${USER.id}`)).toBe(EXERCISE_ID));
  });

  it('exercise_header_has_a_breadcrumb', async () => {
    exerciseApi(exercise({ step: 3, attemptCount: 6, completeAttempts: 4 })).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}` });
    const breadcrumb = await findEl('nav.breadcrumb');
    expect(within(breadcrumb).getByRole('link', { name: 'Exercises' })).toHaveAttribute('href', '/');
    expect(breadcrumb).toHaveTextContent('Exercises / Yangwang Experience / Racing Lines');
    expect(within(breadcrumb).getAllByRole('link')).toHaveLength(1);
  });
});

describe('exercise header', () => {
  it('own_exercise_shows_the_family_only', async () => {
    exerciseApi(exercise({ catalogueId: null, family: 'Licence' })).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}` });
    expect(await screen.findByText('Licence', { selector: '.exercise-where' })).toBeInTheDocument();
  });

  it('catalogue_exercise_shows_family_collection_code_and_track', async () => {
    exerciseApi(exercise({ catalogueId: 'licence-b-4', family: 'Licence' }))
      .on('GET /api/progress', { collections: [], exercises: [{ id: EXERCISE_ID, name: 'Cornering Basics 2', family: 'Licence', collection: 'National B', status: 'practising', bestMs: null, bestByDay: [] }] })
      .on('GET /api/catalogue', [catalogueEntry({ id: 'licence-b-4', code: 'B-4', track: 'Alsace – Village', car: "Yangwang U9 '24" })])
      .install();
    renderApp({ path: `/exercises/${EXERCISE_ID}` });
    expect(await screen.findByText('Licence · National B, B-4 · Alsace – Village', { selector: '.exercise-where' })).toBeInTheDocument();
  });
});
