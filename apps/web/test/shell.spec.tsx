import { Profiler } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { exercise, exerciseApi, rememberExercise } from './fixtures.ts';
import { LiveProvider } from '../src/api/live.tsx';
import { RouterProvider } from '../src/app/router.tsx';
import { SessionContext } from '../src/app/session.tsx';
import { Shell } from '../src/app/Shell.tsx';
import { ApiStub, FakeSockets, liveState, renderApp, setViewportWidth, signedIn, USER } from './support.tsx';

afterEach(() => {
  delete document.documentElement.dataset.theme;
  window.localStorage.clear();
});

describe('shell', () => {
  it('shell_does_not_render_on_a_speed_change', async () => {
    setViewportWidth(1440);
    window.history.replaceState(null, '', '/no-such-page');
    signedIn(new ApiStub()).on('GET /api/exercises', []).on('GET /api/progress', { collections: [], exercises: [] }).install();
    const sockets = new FakeSockets();
    let commits = 0;
    render(
      <SessionContext.Provider value={{ user: USER, signOut: async () => undefined, ended: () => undefined }}>
        <LiveProvider socketFactory={sockets.factory}>
          <RouterProvider>
            <Profiler id="shell" onRender={() => commits++}>
              <Shell />
            </Profiler>
          </RouterProvider>
        </LiveProvider>
      </SessionContext.Provider>
    );
    await screen.findByRole('navigation', { name: 'Main' });
    const socket = sockets.latest;
    act(() => {
      socket.open();
      socket.receive({ type: 'state', state: liveState({ mode: 'driving', exerciseId: null, connection: 'connected', speedMps: 10, seq: 1 }) });
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    const settled = commits;
    act(() => socket.receive({ type: 'state', state: liveState({ mode: 'driving', exerciseId: null, connection: 'connected', speedMps: 40, seq: 2 }) }));
    act(() => socket.receive({ type: 'state', state: liveState({ mode: 'driving', exerciseId: null, connection: 'connected', speedMps: 41, seq: 3 }) }));
    expect(commits).toBe(settled);
  });

  it('wide_nav_has_exercises_setup_and_drive_button', async () => {
    setViewportWidth(1440);
    rememberExercise();
    exerciseApi(exercise({ name: 'Racing Line: Intermediate' })).install();
    renderApp();
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(nav).toHaveAttribute('data-placement', 'top');
    expect(within(nav).getByRole('link', { name: 'Exercises' })).toHaveAttribute('href', '/');
    expect(within(nav).getByRole('link', { name: 'Setup' })).toHaveAttribute('href', '/setup');
    const drive = await screen.findByRole('link', { name: /^Drive/ });
    expect(drive).toHaveTextContent('Racing Line');
    expect(drive).toHaveAttribute('href', '/drive');
    expect(screen.getByRole('link', { name: /^Console/ })).toHaveAttribute('href', '/setup#console');
    expect(screen.getByRole('link', { name: /^Voice/ })).toHaveAttribute('href', '/setup#voice');
  });

  it('shell_header_shows_logo', async () => {
    setViewportWidth(1440);
    signedIn(new ApiStub()).on('GET /api/exercises', []).on('GET /api/progress', { collections: [], exercises: [] }).install();
    renderApp();
    const banner = await screen.findByRole('banner');
    const logos = within(banner).getAllByRole('img', { name: 'GT7 Tutor' });
    expect(logos).toHaveLength(1);
    expect([...logos[0]!.querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual([
      '/brand/logo-light-600.png',
      '/brand/logo-dark-600.png'
    ]);
    expect(within(banner).getByRole('link', { name: 'GT7 Tutor' })).toHaveAttribute('href', '/');
  });

  it('training_exercise_becomes_current_on_this_device', async () => {
    setViewportWidth(1440);
    const racing = exercise({ name: 'Racing Line: Intermediate' });
    const basics = exercise({ id: 'e0000000-0000-4000-8000-000000000002', name: 'Cornering Basics 1', activeReferenceId: null });
    rememberExercise(basics.id);
    exerciseApi(racing).on('GET /api/exercises', [racing, basics]).install();
    const view = renderApp();
    expect(await screen.findByRole('link', { name: /^Drive/ })).toHaveTextContent('Cornering Basics 1');
    const socket = await waitFor(() => view.sockets.latest);
    act(() => {
      socket.open();
      socket.receive({ type: 'state', state: liveState({ mode: 'armed', exerciseId: racing.id, connection: 'connected' }) });
    });
    await waitFor(() => expect(screen.getByRole('link', { name: /^Drive/ })).toHaveTextContent('Racing Line'));
    expect(window.localStorage.getItem('gt7.currentExercise.user-1')).toBe(racing.id);
    act(() => socket.receive({ type: 'state', state: liveState({ mode: 'idle', exerciseId: null, seq: 9 }) }));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.getByRole('link', { name: /^Drive/ })).toHaveTextContent('Racing Line');
  });

  it('drive_button_hidden_without_current_exercise', async () => {
    setViewportWidth(1440);
    signedIn(new ApiStub()).on('GET /api/exercises', []).on('GET /api/progress', { collections: [], exercises: [] }).install();
    renderApp();
    await screen.findByRole('navigation', { name: 'Main' });
    await waitFor(() => expect(screen.queryByText('Reading your exercises…')).toBeNull());
    expect(screen.queryByRole('link', { name: /^Drive/ })).toBeNull();
  });

  it('phone_shell_does_not_read_the_exercises', async () => {
    setViewportWidth(390);
    const api = signedIn(new ApiStub()).install();
    renderApp({ path: '/no-such-page' });
    await screen.findByRole('navigation', { name: 'Main' });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(api.called('GET /api/exercises')).toBe(false);
  });

  it('drive_button_follows_navigation_without_reading_the_list_again', async () => {
    setViewportWidth(1440);
    const racing = exercise({ name: 'Racing Line: Intermediate' });
    const basics = exercise({ id: 'e0000000-0000-4000-8000-000000000002', name: 'Cornering Basics 1', activeReferenceId: null });
    rememberExercise(basics.id);
    const api = exerciseApi(racing).on('GET /api/exercises', [racing, basics]).install();
    renderApp({ path: '/no-such-page' });
    expect(await screen.findByRole('link', { name: /^Drive/ })).toHaveTextContent('Cornering Basics 1');
    act(() => {
      window.history.pushState(null, '', `/exercises/${racing.id}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(screen.getByRole('link', { name: /^Drive/ })).toHaveTextContent('Racing Line'));
    act(() => {
      window.history.pushState(null, '', '/no-such-page');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await screen.findByRole('heading', { level: 1 });
    expect(api.calls.filter(call => call.method === 'GET' && call.path === '/api/exercises')).toHaveLength(1);
  });

  it('exercises_nav_current_on_exercise_pages', async () => {
    setViewportWidth(1440);
    exerciseApi().install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/attempts' });
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Exercises' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Setup' })).not.toHaveAttribute('aria-current');
  });

  it('phone_bottom_nav_has_three_items_and_a_gear', async () => {
    setViewportWidth(390);
    exerciseApi().install();
    renderApp();
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(nav).toHaveAttribute('data-placement', 'bottom');
    expect(nav.closest('header')).toBeNull();
    const links = within(nav).getAllByRole('link');
    expect(links.map(link => link.textContent)).toEqual(['Exercises', 'Drive', 'Setup']);
    expect(within(nav).getByRole('link', { name: 'Setup' }).querySelector('[data-icon="gear"]')).not.toBeNull();
    expect(within(nav).getByRole('link', { name: 'Exercises' }).querySelector('[data-icon="list"]')).not.toBeNull();
    expect(within(nav).getByRole('link', { name: 'Drive' }).querySelector('[data-icon="drive"]')).not.toBeNull();
  });

  it('phone_header_shows_console_and_voice_status', async () => {
    setViewportWidth(390);
    exerciseApi().install();
    renderApp();
    const banner = await screen.findByRole('banner');
    expect(within(banner).getByRole('link', { name: /^Console/ })).toHaveAttribute('href', '/setup#console');
    expect(within(banner).getByRole('link', { name: 'Voice: Voice not ready. Open Setup' })).toHaveAttribute('href', '/setup#voice');
    expect(within(banner).getByRole('button', { name: 'Profile Driver' })).toBeInTheDocument();
  });

  it('profile_menu_signs_out', async () => {
    setViewportWidth(1440);
    const api = exerciseApi().on('POST /api/auth/sign-out', { status: 204 }).install();
    renderApp();
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Profile Driver' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(button);
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Manage profiles' })).toHaveAttribute('href', '/setup#profiles');
    expect(within(menu).getByRole('menuitem', { name: 'Voice on this device' })).toHaveAttribute('href', '/setup#voice');
    await user.click(within(menu).getByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(api.called('POST /api/auth/sign-out')).toBe(true));
  });

  it('profile_menu_closes_on_escape_and_returns_focus', async () => {
    setViewportWidth(1440);
    exerciseApi().install();
    renderApp();
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Profile Driver' });
    await user.click(button);
    expect(screen.getByRole('menuitem', { name: 'Manage profiles' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button).toHaveFocus();
    await user.click(button);
    await user.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('running_capture_banner_stays_on_normal_pages', async () => {
    setViewportWidth(1440);
    exerciseApi().install();
    const view = renderApp({ path: '/setup' });
    await waitFor(() => view.sockets.latest);
    act(() => {
      view.sockets.latest.open();
      view.sockets.latest.receive({ type: 'state', state: liveState({ mode: 'capturing', exerciseId: 'e0000000-0000-4000-8000-000000000001', connection: 'connected' }) });
    });
    expect(await screen.findByText(/A recording is running/)).toBeInTheDocument();
  });

  it('theme_switch_in_menu_sets_dark', async () => {
    setViewportWidth(1440);
    exerciseApi().install();
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Profile Driver' }));
    const group = within(screen.getByRole('menu')).getByRole('radiogroup', { name: 'Theme' });
    expect(within(group).getByRole('radio', { name: 'System theme' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(group).getByRole('radio', { name: 'Dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(within(group).getByRole('radio', { name: 'Dark theme' })).toHaveAttribute('aria-checked', 'true');
    expect(within(group).getByRole('radio', { name: 'System theme' })).toHaveAttribute('aria-checked', 'false');
  });
});
