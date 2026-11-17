import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Progress } from '@gt7/contracts';
import { ApiStub, renderApp, setViewportWidth, signedIn } from './support.tsx';

const PROGRESS: Progress = {
  collections: [
    { family: 'Brand Central', collection: 'Yangwang', counts: { new: 0, ready: 0, practising: 1, bronze: 0, silver: 0, gold: 0 } },
    { family: 'Licence', collection: 'National B', counts: { new: 2, ready: 1, practising: 0, bronze: 0, silver: 1, gold: 0 } }
  ],
  exercises: [
    {
      id: 'ex-1',
      name: 'Racing Lines',
      family: 'Brand Central',
      collection: 'Yangwang',
      status: 'practising',
      bestMs: 26800,
      bestByDay: [
        { date: '2026-11-16', bestMs: 27100 },
        { date: '2026-11-17', bestMs: 26800 }
      ]
    },
    { id: 'ex-2', name: 'B-1 Starting & Stopping 1', family: 'Licence', collection: 'National B', status: 'new', bestMs: null, bestByDay: [] }
  ]
};

describe('progress', () => {
  it('progress_shows_status_counts_and_best_by_day', async () => {
    setViewportWidth(1280);
    signedIn(new ApiStub()).on('GET /api/progress', PROGRESS).install();
    renderApp({ path: '/progress' });
    const counts = await screen.findByRole('table', { name: 'Status by collection' });
    const licence = within(counts).getByRole('row', { name: /National B/ });
    expect(within(licence).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['Licence', 'National B', '2', '1', '0', '0', '1', '0']);
    const exercise = screen.getByRole('region', { name: 'Racing Lines' });
    expect(exercise).toHaveTextContent('0:26.80');
    expect(exercise).toHaveTextContent('measured');
    expect(within(exercise).getByRole('list', { name: 'Best time by practice day' })).toHaveTextContent('16 November0:27.10');
    expect(within(exercise).getByRole('list', { name: 'Best time by practice day' })).toHaveTextContent('17 November0:26.80');
    expect(screen.getByRole('region', { name: 'B-1 Starting & Stopping 1' })).toHaveTextContent('No complete attempt yet');
  });
});

describe('progress recurring', () => {
  it('progress_lists_recurring_differences_per_exercise', async () => {
    setViewportWidth(1280);
    signedIn(new ApiStub())
      .on('GET /api/progress', PROGRESS)
      .on('GET /api/exercises/ex-1/recurring', [{ kind: 'throttle-late', eventKey: 'throttle@491', sM: 491, size: 12, unit: 'm', count: 3, of: 4, medianSize: 11 }])
      .install();
    renderApp({ path: '/progress' });
    const exercise = await screen.findByRole('region', { name: 'Racing Lines' });
    expect(await within(exercise).findByText('Throttle late at 491 m in 3 of 4 attempts, median 11 m')).toBeInTheDocument();
  });
});
