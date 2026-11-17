import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { exercise, exerciseApi } from './fixtures.ts';
import { ATTEMPT_LIST } from './review-fixtures.ts';
import { renderApp, setViewportWidth } from './support.tsx';

describe('attempts', () => {
  it('attempts_group_by_day_and_mark_best', async () => {
    setViewportWidth(1280);
    exerciseApi(exercise({ completeAttempts: 2, bestMs: 26800 })).on('GET /api/exercises/ex-1/attempts', ATTEMPT_LIST).install();
    renderApp({ path: '/exercises/ex-1/attempts' });
    const days = await screen.findAllByRole('table', { name: /^Attempts on/ });
    expect(days.map(day => day.getAttribute('aria-label'))).toEqual(['Attempts on 17 November', 'Attempts on 16 November']);
    const best = within(days[0]!).getByRole('row', { name: /Attempt 2/ });
    expect(best).toHaveTextContent('0:26.80');
    expect(within(best).getByText('best')).toBeInTheDocument();
    const first = within(days[1]!).getByRole('row', { name: /Attempt 1/ });
    expect(first).toHaveTextContent('+0.30 s');
    expect(first).toHaveTextContent('332 m. Braked 14 m earlier');
    expect(within(first).queryByText('best')).not.toBeInTheDocument();
    expect(within(first).getByRole('link', { name: 'Review attempt 1' })).toHaveAttribute('href', '/attempts/att-1/review');
  });

  it('official_time_shows_thousandths', async () => {
    setViewportWidth(1280);
    const official = { ...ATTEMPT_LIST.days[0]!.attempts[1]!, officialMs: 23429, timeMs: 23429 };
    const list = { ...ATTEMPT_LIST, days: [{ ...ATTEMPT_LIST.days[0]!, attempts: [official] }] };
    exerciseApi().on('GET /api/exercises/ex-1/attempts', list).install();
    renderApp({ path: '/exercises/ex-1/attempts' });
    const row = await screen.findByRole('row', { name: new RegExp(`Attempt ${official.number}`) });
    expect(row).toHaveTextContent('0:23.429');
    expect(row).toHaveTextContent('official');
  });

  it('aborted_attempt_has_no_time', async () => {
    setViewportWidth(390);
    exerciseApi().on('GET /api/exercises/ex-1/attempts', ATTEMPT_LIST).install();
    renderApp({ path: '/exercises/ex-1/attempts' });
    const row = await screen.findByRole('row', { name: /Attempt 3/ });
    expect(row).toHaveTextContent('No time');
    expect(row).toHaveTextContent('aborted');
    expect(row).not.toHaveTextContent(/\d:\d\d\.\d\d/);
  });

  it('recurring_shows_count_of_attempts', async () => {
    setViewportWidth(1280);
    exerciseApi(exercise({ completeAttempts: 8 }))
      .on('GET /api/exercises/ex-1/attempts', ATTEMPT_LIST)
      .on('GET /api/exercises/ex-1/recurring', [{ kind: 'brake-early', eventKey: 'brake@412', sM: 412, size: 15, unit: 'm', count: 6, of: 8, medianSize: 14 }])
      .install();
    renderApp({ path: '/exercises/ex-1/attempts' });
    const section = await screen.findByRole('region', { name: 'Recurring differences' });
    expect(await within(section).findByText('Braked early at 412 m in 6 of 8 attempts, median 14 m')).toBeInTheDocument();
  });

  it('fewer_than_three_attempts_says_so', async () => {
    setViewportWidth(1280);
    exerciseApi(exercise({ completeAttempts: 2 })).on('GET /api/exercises/ex-1/attempts', ATTEMPT_LIST).install();
    renderApp({ path: '/exercises/ex-1/attempts' });
    const section = await screen.findByRole('region', { name: 'Recurring differences' });
    expect(within(section).getByText(/at least three complete attempts\. You have 2\./)).toBeInTheDocument();
  });
});
