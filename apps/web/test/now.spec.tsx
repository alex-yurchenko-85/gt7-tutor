import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ExerciseStep } from '@gt7/contracts';
import { exerciseApi, exerciseAtStep, rememberExercise } from './fixtures.ts';
import { renderApp, setViewportWidth } from './support.tsx';

const EXPECTED: Record<ExerciseStep, { step: RegExp; action: string }> = {
  1: { step: /Record the reference/, action: 'Record the reference' },
  2: { step: /Baseline attempts without voice/, action: 'Start a baseline attempt' },
  3: { step: /Guided attempts with voice/, action: 'Start a guided attempt' },
  4: { step: /Review/, action: 'Open the attempts' }
};

describe('now', () => {
  for (const step of [1, 2, 3, 4] as ExerciseStep[]) {
    it(`now_highlights_current_step ${step}`, async () => {
      setViewportWidth(1280);
      exerciseApi(exerciseAtStep(step)).install();
      rememberExercise();
      renderApp({ path: '/' });
      const current = await screen.findByRole('listitem', { current: 'step' });
      expect(current).toHaveTextContent(EXPECTED[step].step);
      expect(screen.getAllByRole('listitem').filter(item => item.getAttribute('aria-current') === 'step')).toHaveLength(1);
      const primary = document.querySelectorAll('[data-primary="true"]');
      expect(primary).toHaveLength(1);
      expect(primary[0]).toHaveTextContent(EXPECTED[step].action);
    });
  }

  it('now_without_exercise_points_to_the_catalogue', async () => {
    setViewportWidth(390);
    exerciseApi().on('GET /api/exercises', []).install();
    renderApp({ path: '/' });
    expect(await screen.findByRole('link', { name: 'Select an exercise' })).toHaveAttribute('href', '/catalogue');
  });

  it('exercise_header_is_the_same_on_every_tab', async () => {
    setViewportWidth(1280);
    const sections: [string, string | null][] = [
      ['/', null],
      ['/exercises/ex-1/cues', 'What the voice will say'],
      ['/exercises/ex-1/references', 'Reference history'],
      ['/exercises/ex-1/attempts', null]
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
});

