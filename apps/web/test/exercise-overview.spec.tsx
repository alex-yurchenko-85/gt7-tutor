import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { KPH_PER_MPS, type ExerciseStep, type RecurringDifference } from '@gt7/contracts';
import { exercise, exerciseApi, exerciseAtStep, rememberExercise, TRACE } from './fixtures.ts';
import { renderApp, setViewportWidth, USER } from './support.tsx';

const EXPECTED: Record<ExerciseStep, { step: RegExp; action: string }> = {
  1: { step: /^Reference/, action: 'Record the reference' },
  2: { step: /^Attempts/, action: 'Start an attempt' },
  3: { step: /^Review/, action: 'Open the attempts' }
};

describe('exercise overview', () => {
  for (const step of [1, 2, 3] as ExerciseStep[]) {
    it(`overview_highlights_current_step ${step}`, async () => {
      setViewportWidth(1280);
      exerciseApi(exerciseAtStep(step)).install();
      rememberExercise();
      renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001' });
      const current = await screen.findByRole('listitem', { current: 'step' });
      expect(current).toHaveTextContent(EXPECTED[step].step);
      expect(screen.getAllByRole('listitem').filter(item => item.getAttribute('aria-current') === 'step')).toHaveLength(1);
      const primary = document.querySelectorAll('[data-primary="true"]');
      expect(primary).toHaveLength(1);
      expect(primary[0]).toHaveTextContent(EXPECTED[step].action);
    });
  }

  it('reference_step_text_says_the_reference_is_recorded_once', async () => {
    setViewportWidth(1280);
    exerciseApi(exerciseAtStep(1)).install();
    rememberExercise();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001' });
    expect(await screen.findByRole('heading', { name: 'No reference yet' })).toBeInTheDocument();
    const text = 'The reference is the demonstration that the game shows before the exercise. GT7 Tutor records it once.';
    expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent(/three times|game timer/);
  });

  it('exercise_header_is_the_same_on_every_tab', async () => {
    setViewportWidth(1280);
    const sections: [string, string | null][] = [
      ['/exercises/e0000000-0000-4000-8000-000000000001', null],
      ['/exercises/e0000000-0000-4000-8000-000000000001/cues', null],
      ['/exercises/e0000000-0000-4000-8000-000000000001/references', 'Reference history'],
      ['/exercises/e0000000-0000-4000-8000-000000000001/attempts', null]
    ];
    for (const [path, section] of sections) {
      exerciseApi(exerciseAtStep(3)).install();
      rememberExercise();
      const view = renderApp({ path });
      const navigation = await screen.findByRole('navigation', { name: 'Exercise' });
      const title = screen.getByRole('heading', { level: 1 });
      expect(title, path).toHaveTextContent('Yangwang Experience / Racing Lines');
      expect(title.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      if (section) {
        const heading = await screen.findByRole('heading', { level: 2, name: section });
        expect(navigation.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING, path).toBeTruthy();
      }
      expect(document.querySelectorAll('.exercise-header > *')).toHaveLength(3);
      view.unmount();
    }
  });

  it('overview_shows_gap_to_reference', async () => {
    setViewportWidth(1440);
    exerciseApi(exercise({ step: 3, bestMs: 26500, completeAttempts: 4 }))
      .on('GET /api/references/ref-demo/path', { ...TRACE, timeMs: 25470 })
      .install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001' });
    const times = await screen.findByRole('region', { name: 'Times from the game' });
    expect(await within(times).findByText('+1.03 s')).toBeInTheDocument();
    expect(times).toHaveTextContent('0:26.500your best');
    expect(times).toHaveTextContent('0:25.470reference');
    expect(times).toHaveTextContent('gap to the reference');
  });

  it('overview_secondary_actions_are_links_not_buttons', async () => {
    setViewportWidth(1440);
    exerciseApi(exerciseAtStep(2)).install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001' });
    const next = await screen.findByRole('region', { name: /^Next:/ });
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
    expect(within(next).getAllByRole('link')).toHaveLength(2);
    const cues = within(next).getByRole('link', { name: 'Hear the cues first' });
    expect(cues).toHaveAttribute('href', '/exercises/e0000000-0000-4000-8000-000000000001/cues');
    expect(cues).not.toHaveClass('btn');
  });

  it('step_two_names_the_cues_and_the_review_rule', async () => {
    setViewportWidth(1280);
    exerciseApi(exerciseAtStep(2)).install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001' });
    const next = await screen.findByRole('region', { name: 'Next: drive attempts' });
    await waitFor(() =>
      expect(next).toHaveTextContent('The Drive screen shows the 3 cues of the reference. A voice device also says them. After 3 complete attempts, review them.')
    );
    expect(within(next).getByRole('link', { name: 'Start an attempt' })).toHaveAttribute('href', '/drive');
    expect(within(next).getByRole('link', { name: 'Hear the cues first' })).toBeInTheDocument();
  });

  it('step_two_without_loaded_cues_has_no_count', async () => {
    setViewportWidth(1280);
    exerciseApi(exercise({ step: 2, activeReferenceId: 'ref-without-cues' })).install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001' });
    const next = await screen.findByRole('region', { name: 'Next: drive attempts' });
    expect(next).toHaveTextContent('The Drive screen shows the cues of the reference. A voice device also says them. After 3 complete attempts, review them.');
  });

  it('step_three_links_to_a_new_attempt', async () => {
    setViewportWidth(1280);
    exerciseApi(exerciseAtStep(3)).install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001' });
    const next = await screen.findByRole('region', { name: 'Next: review your attempts' });
    expect(within(next).getByRole('link', { name: 'Start an attempt' })).toHaveAttribute('href', '/drive');
    expect(within(next).getByRole('link', { name: 'Open the attempts' })).toBeInTheDocument();
  });

  it('no_attempt_mode_text_on_the_exercise_page', async () => {
    setViewportWidth(1280);
    exerciseApi(exerciseAtStep(2)).install();
    rememberExercise();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001' });
    await screen.findByRole('link', { name: 'Start an attempt' });
    expect(document.body.textContent).not.toMatch(/baseline|guided|without voice|No device plays the voice/i);
  });

  it('overview_shows_three_recurring_with_turns', async () => {
    setViewportWidth(1440);
    const recurring: RecurringDifference[] = [
      { kind: 'brake-early', eventKey: 'brake@677', sM: 677, size: 31, unit: 'm', turn: 2, count: 4, of: 4, medianSize: 31 },
      { kind: 'slow-corner', eventKey: 'brake@677', sM: 700, size: 16 / KPH_PER_MPS, unit: 'm/s', turn: 2, count: 4, of: 4, medianSize: 16 / KPH_PER_MPS },
      { kind: 'wide-apex', eventKey: 'corner-1', sM: 519, size: 4, unit: 'm', turn: 1, count: 3, of: 4, medianSize: 4 },
      { kind: 'throttle-late', eventKey: 'throttle@760', sM: 760, size: 12, unit: 'm', turn: 2, count: 2, of: 4, medianSize: 12 }
    ];
    exerciseApi(exerciseAtStep(3)).on('GET /api/exercises/e0000000-0000-4000-8000-000000000001/recurring', recurring).install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001' });
    const work = await screen.findByRole('region', { name: 'Work on these first' });
    const rows = await within(work).findAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('T2');
    expect(rows[0]).toHaveTextContent('Braked early, median 31 m');
    expect(rows[0]).toHaveTextContent('4 of 4');
    expect(rows[2]).toHaveTextContent('T1');
    expect(work).toHaveTextContent('Differences that repeat in your last 4 complete attempts.');
    expect(within(work).getByRole('link', { name: 'All 4 differences' })).toHaveAttribute('href', '/exercises/e0000000-0000-4000-8000-000000000001/attempts');
  });

  it('view_opens_full_screen_map_and_escape_closes', async () => {
    setViewportWidth(1440);
    exerciseApi(exerciseAtStep(3)).install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001' });
    const user = userEvent.setup();
    const view = await screen.findByRole('button', { name: 'View the map in full screen' });
    await user.click(view);
    const dialog = screen.getByRole('dialog', { name: 'Yangwang Experience / Racing Lines' });
    expect(dialog).toHaveAttribute('open');
    expect(within(dialog).getByRole('checkbox', { name: 'Cues' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Turns' })).toBeChecked();
    const cue = within(within(dialog).getByRole('complementary', { name: 'Voice cues' })).getByRole('button', { name: /Hard brake/ });
    expect(cue).toHaveAttribute('aria-pressed', 'false');
    await user.click(cue);
    expect(cue).toHaveAttribute('aria-pressed', 'true');
    expect(dialog.querySelector('.track-mark.selected')).not.toBeNull();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Turns' }));
    expect(dialog.querySelector('.track-mark.apex')).toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(view).toHaveFocus();
  });

  it('step_numbers_are_light_decoration', async () => {
    setViewportWidth(1280);
    exerciseApi(exerciseAtStep(3)).install();
    rememberExercise();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001' });
    const steps = within(await screen.findByRole('list', { name: 'Three steps' })).getAllByRole('listitem');
    expect(steps.map(step => step.querySelector('.step-number[aria-hidden="true"]')?.textContent)).toEqual(['1', '2', '3']);
    expect(steps.map(step => step.querySelector('b')?.textContent)).toEqual(['Reference', 'Attempts', 'Review']);
  });

  it('visiting_exercise_remembers_it', async () => {
    setViewportWidth(390);
    exerciseApi(exerciseAtStep(2)).install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001' });
    await screen.findByRole('heading', { level: 1, name: 'Yangwang Experience / Racing Lines' });
    await waitFor(() => expect(window.localStorage.getItem(`gt7.currentExercise.${USER.id}`)).toBe('e0000000-0000-4000-8000-000000000001'));
  });

  it('exercise_header_has_breadcrumb_and_overview_tab', async () => {
    setViewportWidth(1440);
    exerciseApi(exercise({ step: 3, completeAttempts: 6 })).install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001' });
    const breadcrumb = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(breadcrumb).getByRole('link', { name: 'Exercises' })).toHaveAttribute('href', '/');
    expect(breadcrumb).toHaveTextContent('Exercises / Brand Central');
    const tabs = screen.getByRole('navigation', { name: 'Exercise' });
    expect(within(tabs).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/exercises/e0000000-0000-4000-8000-000000000001');
    expect(within(tabs).getByRole('link', { name: /^Attempts/ })).toHaveTextContent('Attempts 6');
  });

  it('overview_has_no_remove_action', async () => {
    setViewportWidth(1280);
    exerciseApi(exercise({ attemptCount: 6, referenceCount: 2 })).install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001' });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(screen.queryByText(/Removes the exercise/)).toBeNull();
  });
});
