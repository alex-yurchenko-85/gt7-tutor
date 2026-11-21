import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ReferenceInfo } from '@gt7/contracts';
import { exerciseApi, reference, EXERCISE_ID } from './fixtures.ts';
import { renderApp } from './support.tsx';

describe('reference history', () => {
  it('reference_history_can_return_to_demonstration', async () => {
    let references: ReferenceInfo[] = [
      reference({ id: 'ref-demo', active: false, attemptCount: 3 }),
      reference({ id: 'ref-attempt', origin: 'attempt', active: true, createdAt: '2026-11-17T10:00:00.000Z', attemptCount: 0 })
    ];
    const api = exerciseApi()
      .on(`GET /api/exercises/${EXERCISE_ID}/references`, () => references)
      .on('POST /api/references/ref-demo/activate', () => {
        references = references.map(item => ({ ...item, active: item.id === 'ref-demo' }));
        return references[0];
      })
      .install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/references` });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Return to the demonstration' }));
    await waitFor(() => expect(api.called('POST /api/references/ref-demo/activate')).toBe(true));
    expect(await screen.findByRole('button', { name: 'Make active' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Return to the demonstration' })).not.toBeInTheDocument();
    expect(screen.getByText('A reference is never overwritten.', { exact: false })).toBeInTheDocument();
  });

  it('reference_history_counts_the_attempts_that_use_a_reference', async () => {
    exerciseApi()
      .on(`GET /api/exercises/${EXERCISE_ID}/references`, () => [
        reference({ id: 'ref-demo', active: true, attemptCount: 1 }),
        reference({ id: 'ref-attempt', origin: 'attempt', active: false, createdAt: '2026-11-17T10:00:00.000Z', attemptCount: 3 })
      ])
      .install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/references` });
    expect(await screen.findByText(/1 attempt uses it\./)).toBeInTheDocument();
    expect(screen.getByText(/3 attempts use it\./)).toBeInTheDocument();
  });

  const REFERENCES = `GET /api/exercises/${EXERCISE_ID}/references`;
  const unused = () => [
    reference({ id: 'ref-demo', active: true, attemptCount: 1 }),
    reference({ id: 'ref-attempt', origin: 'attempt', active: false, createdAt: '2026-11-17T10:00:00.000Z', attemptCount: 0 })
  ];

  it('reference_delete_asks_in_a_dialog', async () => {
    const api = exerciseApi().on(REFERENCES, unused).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/references` });
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Delete' });
    expect(button).toHaveClass('btn', 'inline', 'danger');
    await user.click(button);
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this reference?' });
    expect(dialog).toHaveTextContent('Your attempt, 17 November. No attempt uses it.');
    expect(dialog).toHaveTextContent('The active reference does not change.');
    expect(dialog).toHaveTextContent('You cannot undo it.');
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.calls.some(call => call.method === 'DELETE')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Delete reference' })).toBeNull();
  });

  it('reference_delete_sends_the_request_and_reloads', async () => {
    let references = unused();
    const api = exerciseApi()
      .on(REFERENCES, () => references)
      .on('DELETE /api/references/ref-attempt', () => {
        references = references.filter(item => item.id !== 'ref-attempt');
        return { ok: true };
      })
      .install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/references` });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete reference' }));
    await waitFor(() => expect(api.called('DELETE /api/references/ref-attempt')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('reference_delete_error_shows_in_the_dialog', async () => {
    exerciseApi()
      .on(REFERENCES, unused)
      .on('DELETE /api/references/ref-attempt', { status: 409, body: { code: 'busy' } })
      .install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/references` });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete reference' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Stop the training or the recording first.');
  });
});
