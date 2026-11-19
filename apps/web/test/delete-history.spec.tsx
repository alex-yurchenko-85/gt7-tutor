import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { exercise } from './fixtures.ts';
import { ApiStub, renderApp, setViewportWidth, signedIn, USER } from './support.tsx';

const RACING = exercise({ attemptCount: 6, referenceCount: 1, completeAttempts: 4, name: 'Racing Line: Intermediate' });
const LICENCE = exercise({ id: 'e0000000-0000-4000-8000-000000000002', name: 'Cornering Basics 1', attemptCount: 2, referenceCount: 2 });

function historyApi(): ApiStub {
  return signedIn(new ApiStub())
    .on('GET /api/settings', { ps5Ip: '10.0.0.5', gameVersion: null })
    .on('GET /api/storage', { rawBytes: 12_000_000, profileRawBytes: 11_700_000, profileCaptures: 8 })
    .on('GET /api/exercises', [RACING, LICENCE])
    .on('POST /api/history/delete', { attempts: 8, references: 3, cleanup: { captures: 2, bytesBefore: 11_700_000, bytesAfter: 4_000_000 } })
    .install();
}

async function typeName(name: string) {
  await userEvent.type(screen.getByLabelText(`Type the profile name ${USER.name} to confirm`), name);
}

describe('delete history', () => {
  it('delete_history_needs_profile_name', async () => {
    setViewportWidth(1280);
    historyApi();
    renderApp({ path: '/setup/delete-history' });
    const section = await screen.findByRole('region', { name: 'Delete history' });
    expect(section).toHaveTextContent(`This affects the profile ${USER.name} only. It cannot be undone.`);
    expect(within(section).getByRole('radio', { name: /^All attempts/ })).toBeChecked();
    expect(await within(section).findByRole('radio', { name: 'All attempts 8 attempts in 2 exercises. References and exercises stay.' })).toBeChecked();
    const action = within(section).getByRole('button', { name: 'Delete all attempts' });
    expect(action).toBeDisabled();
    await typeName(USER.name.toLowerCase());
    expect(action).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(`Type the profile name ${USER.name} to confirm`));
    await typeName(USER.name);
    expect(action).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Data' })).toHaveAttribute('aria-current', 'page');
  });

  it('delete_history_sends_scope_and_cleanup', async () => {
    setViewportWidth(1280);
    const api = historyApi();
    renderApp({ path: '/setup/delete-history' });
    const section = await screen.findByRole('region', { name: 'Delete history' });
    await userEvent.click(within(section).getByRole('radio', { name: /Start over/ }));
    expect(section).toHaveTextContent('This deletes: 8 attempts, 3 references, the progress of 2 exercises.');
    const cleanup = within(section).getByRole('checkbox', { name: /Also clean up the raw captures that nothing uses afterwards/ });
    expect(cleanup).toBeChecked();
    await userEvent.click(cleanup);
    await typeName(USER.name);
    await userEvent.click(within(section).getByRole('button', { name: 'Delete everything and start over' }));
    await waitFor(() => expect(api.called('POST /api/history/delete')).toBe(true));
    expect(api.calls.find(call => call.path === '/api/history/delete')!.body).toEqual({ scope: 'everything', cleanup: false });
    expect(await within(section).findByRole('status')).toHaveTextContent('Deleted 8 attempts and 3 references.');

    await userEvent.click(within(section).getByRole('radio', { name: /Attempts of one exercise/ }));
    await userEvent.selectOptions(within(section).getByLabelText('Exercise'), 'Cornering Basics 1 (2 attempts)');
    expect(section).toHaveTextContent('This deletes: 2 attempts of Cornering Basics 1, with their cue events and differences.');
    await userEvent.click(cleanup);
    await typeName(USER.name);
    await userEvent.click(within(section).getByRole('button', { name: 'Delete 2 attempts' }));
    await waitFor(() => expect(api.calls.filter(call => call.path === '/api/history/delete')).toHaveLength(2));
    expect(api.calls.filter(call => call.path === '/api/history/delete')[1]!.body).toEqual({ scope: 'exercise', exerciseId: LICENCE.id, cleanup: true });
  });

  it('delete_history_busy_shows_message', async () => {
    setViewportWidth(1280);
    historyApi().on('POST /api/history/delete', { status: 409, body: { code: 'busy', reason: 'Stop the training or the recording first.' } });
    renderApp({ path: '/setup/delete-history' });
    const section = await screen.findByRole('region', { name: 'Delete history' });
    await typeName(USER.name);
    await userEvent.click(within(section).getByRole('button', { name: 'Delete all attempts' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('Stop the training or the recording first.');
  });

  it('phone_delete_history_has_a_way_back', async () => {
    setViewportWidth(390);
    historyApi();
    renderApp({ path: '/setup/delete-history' });
    await screen.findByRole('region', { name: 'Delete history' });
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Data' })).toHaveAttribute('href', '/setup#data');
    expect(screen.queryByRole('region', { name: 'Voice' })).not.toBeInTheDocument();
  });

  it('delete_history_names_one_attempt', async () => {
    setViewportWidth(1280);
    historyApi().on('GET /api/exercises', [exercise({ attemptCount: 1, referenceCount: 1, name: 'Racing Line: Intermediate' })]);
    renderApp({ path: '/setup/delete-history' });
    const section = await screen.findByRole('region', { name: 'Delete history' });
    await within(section).findByRole('radio', { name: /^All attempts 1 attempt in 1 exercise/ });
    expect(section).toHaveTextContent('This deletes: the 1 attempt of this profile, with its cue events and differences.');
    await userEvent.click(within(section).getByRole('radio', { name: /Attempts of one exercise/ }));
    expect(section).toHaveTextContent('This deletes: 1 attempt of Racing Line: Intermediate, with its cue events and differences.');
  });
});
