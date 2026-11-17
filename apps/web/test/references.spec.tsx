import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ReferenceInfo } from '@gt7/contracts';
import { exerciseApi, reference } from './fixtures.ts';
import { renderApp, setViewportWidth } from './support.tsx';

describe('reference history', () => {
  it('reference_history_can_return_to_demonstration', async () => {
    setViewportWidth(1280);
    let references: ReferenceInfo[] = [
      reference({ id: 'ref-demo', active: false, attemptCount: 3 }),
      reference({ id: 'ref-attempt', origin: 'attempt', active: true, createdAt: '2026-11-17T10:00:00.000Z', attemptCount: 0 })
    ];
    const api = exerciseApi()
      .on('GET /api/exercises/ex-1/references', () => references)
      .on('POST /api/references/ref-demo/activate', () => {
        references = references.map(item => ({ ...item, active: item.id === 'ref-demo' }));
        return references[0];
      })
      .install();
    renderApp({ path: '/exercises/ex-1/references' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Return to the demonstration' }));
    await waitFor(() => expect(api.called('POST /api/references/ref-demo/activate')).toBe(true));
    expect(await screen.findByRole('button', { name: 'Make active' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Return to the demonstration' })).not.toBeInTheDocument();
    expect(screen.getByText('A reference is never overwritten.', { exact: false })).toBeInTheDocument();
  });
});
