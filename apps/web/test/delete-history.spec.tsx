import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { exercise } from './fixtures.ts';
import { ApiStub, renderApp, sendLiveState, setViewportWidth, signedIn, USER, el, maybeSection, findSection } from './support.tsx';

const RACING = exercise({ attemptCount: 6, referenceCount: 1, completeAttempts: 4, name: 'Racing Line: Intermediate' });
const LICENCE = exercise({ id: 'e0000000-0000-4000-8000-000000000002', name: 'Cornering Basics 1', attemptCount: 2, referenceCount: 2 });

function historyApi(): ApiStub {
  return signedIn(new ApiStub())
    .on('GET /api/settings', { ps5Ip: '10.0.0.5', gameVersion: null })
    .on('GET /api/storage', { rawBytes: 12_000_000, profileRawBytes: 11_700_000, profileCaptures: 8 })
    .on('GET /api/exercises', [RACING, LICENCE])
    .on('GET /api/races', [{ id: 'a0000000-0000-4000-8000-000000000001' }, { id: 'a0000000-0000-4000-8000-000000000002' }])
    .on('POST /api/history/delete', { attempts: 8, references: 3, races: 2, cleanup: { captures: 2, bytesBefore: 11_700_000, bytesAfter: 4_000_000 } })
    .install();
}

async function typeName(name: string) {
  await userEvent.type(screen.getByLabelText(`Type the profile name ${USER.name} to confirm`), name);
}

describe('delete history', () => {
  it('delete_history_needs_profile_name', async () => {
    historyApi();
    renderApp({ path: '/setup/delete-history' });
    const section = await findSection('Delete history');
    expect(section).toHaveTextContent(`This affects the profile ${USER.name} only. It cannot be undone.`);
    expect(within(section).getByRole('radio', { name: /^All attempts/ })).toBeChecked();
    expect(await within(section).findByRole('radio', { name: 'All attempts 8 attempts in 2 exercises. References, exercises and races stay.' })).toBeChecked();
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
    const api = historyApi();
    renderApp({ path: '/setup/delete-history' });
    const section = await findSection('Delete history');
    expect(section).toHaveTextContent('This keeps: the exercises, the references, the races, the settings.');
    expect(within(section).getByRole('radio', { name: 'Start over All attempts, references, exercise progress and races. The profile and its settings stay.' })).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('radio', { name: /Start over/ }));
    expect(section).toHaveTextContent('This deletes: 8 attempts, 3 references, 2 races, the progress of 2 exercises.');
    const cleanup = within(section).getByRole('checkbox', { name: /Also clean up the raw captures that nothing uses afterwards/ });
    expect(cleanup).toBeChecked();
    await userEvent.click(cleanup);
    await typeName(USER.name);
    await userEvent.click(within(section).getByRole('button', { name: 'Delete everything and start over' }));
    await waitFor(() => expect(api.called('POST /api/history/delete')).toBe(true));
    expect(api.calls.find(call => call.path === '/api/history/delete')!.body).toEqual({ scope: 'everything', cleanup: false });
    expect(await within(section).findByRole('status')).toHaveTextContent('Deleted 8 attempts, 3 references and 2 races.');

    await userEvent.click(within(section).getByRole('radio', { name: /Attempts of one exercise/ }));
    await userEvent.selectOptions(within(section).getByLabelText('Exercise'), 'Cornering Basics 1 (2 attempts)');
    expect(section).toHaveTextContent('This deletes: 2 attempts of Cornering Basics 1, with their cues and differences.');
    expect(section).toHaveTextContent('This keeps: the references, the other exercises, the races, the settings.');
    expect(within(section).getByRole('radio', { name: 'Attempts of one exercise For a fresh start on one exercise. Its references and the races stay.' })).toBeChecked();
    await userEvent.click(cleanup);
    await typeName(USER.name);
    await userEvent.click(within(section).getByRole('button', { name: 'Delete 2 attempts' }));
    await waitFor(() => expect(api.calls.filter(call => call.path === '/api/history/delete')).toHaveLength(2));
    expect(api.calls.filter(call => call.path === '/api/history/delete')[1]!.body).toEqual({ scope: 'exercise', exerciseId: LICENCE.id, cleanup: true });
  });

  it('delete_history_busy_shows_message', async () => {
    historyApi().on('POST /api/history/delete', { status: 409, body: { code: 'busy' } });
    renderApp({ path: '/setup/delete-history' });
    const section = await findSection('Delete history');
    await typeName(USER.name);
    await userEvent.click(within(section).getByRole('button', { name: 'Delete all attempts' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('Stop the training or the recording first.');
  });

  it('phone_delete_history_has_a_way_back', async () => {
    setViewportWidth(390);
    historyApi();
    renderApp({ path: '/setup/delete-history' });
    await findSection('Delete history');
    const crumbs = el('nav.breadcrumb');
    expect(within(crumbs).getByRole('link', { name: 'Data' })).toHaveAttribute('href', '/setup#data');
    expect(maybeSection('Voice')).not.toBeInTheDocument();
  });

  it('delete_history_names_one_attempt', async () => {
    historyApi().on('GET /api/exercises', [exercise({ attemptCount: 1, referenceCount: 1, name: 'Racing Line: Intermediate' })]);
    renderApp({ path: '/setup/delete-history' });
    const section = await findSection('Delete history');
    await within(section).findByRole('radio', { name: /^All attempts 1 attempt in 1 exercise/ });
    expect(section).toHaveTextContent('This deletes: the 1 attempt of this profile, with its cues and differences.');
    await userEvent.click(within(section).getByRole('radio', { name: /Attempts of one exercise/ }));
    expect(section).toHaveTextContent('This deletes: 1 attempt of Racing Line: Intermediate, with its cues and differences.');
  });

  it('delete_history_stops_the_training_first', async () => {
    const api = historyApi().on('POST /api/training/disarm', { status: 201, body: { ok: true } });
    const view = renderApp({ path: '/setup/delete-history' });
    await sendLiveState(view, { mode: 'armed', exerciseId: RACING.id });
    const section = await findSection('Delete history');
    await waitFor(() => expect(section).toHaveTextContent(`The training of ${RACING.name} is on. It stops when you delete.`));
    await typeName(USER.name);
    await userEvent.click(within(section).getByRole('button', { name: 'Stop the training and delete' }));
    await waitFor(() => expect(api.called('POST /api/history/delete')).toBe(true));
    expect(api.calls.filter(call => call.method === 'POST').map(call => call.path).slice(0, 2)).toEqual(['/api/training/disarm', '/api/history/delete']);
  });

  it('delete_history_result_names_only_what_went', async () => {
    historyApi().on('POST /api/history/delete', { attempts: 1, references: 0, races: 0, cleanup: null });
    renderApp({ path: '/setup/delete-history' });
    const section = await findSection('Delete history');
    await typeName(USER.name);
    await userEvent.click(within(section).getByRole('button', { name: 'Delete all attempts' }));
    expect(await within(section).findByRole('status')).toHaveTextContent(/^Deleted 1 attempt\.$/);
  });

  it('start_over_names_one_race_and_the_result_counts_races', async () => {
    historyApi()
      .on('GET /api/races', [{ id: 'a0000000-0000-4000-8000-000000000001' }])
      .on('POST /api/history/delete', { attempts: 0, references: 0, races: 1, cleanup: null });
    renderApp({ path: '/setup/delete-history' });
    const section = await findSection('Delete history');
    await userEvent.click(within(section).getByRole('radio', { name: /Start over/ }));
    await waitFor(() => expect(section).toHaveTextContent('This deletes: 8 attempts, 3 references, 1 race, the progress of 2 exercises.'));
    await typeName(USER.name);
    await userEvent.click(within(section).getByRole('button', { name: 'Delete everything and start over' }));
    expect(await within(section).findByRole('status')).toHaveTextContent(/^Deleted 0 attempts and 1 race\.$/);
  });
});
