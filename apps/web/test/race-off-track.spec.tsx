import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { RaceDetail } from '@gt7/contracts';
import { PANORAMA_MOMENTS, PANORAMA_PLACES, RACE_ID, offTrackMoment, offTrackView, raceDetail } from './race-fixtures.ts';
import { ApiStub, renderApp, setViewportWidth, signedIn } from './support.tsx';

const OFF_PATH = `/api/races/${RACE_ID}/off-track`;

function detailWith(overrides: Partial<RaceDetail> = {}): RaceDetail {
  return raceDetail({ offTrack: PANORAMA_MOMENTS.length, offTrackList: PANORAMA_MOMENTS, recurring: PANORAMA_PLACES, ...overrides });
}

async function openOffTrack(detail: RaceDetail = detailWith(), view: unknown = offTrackView()) {
  const api = signedIn(new ApiStub()).on(`GET /api/races/${RACE_ID}`, detail).on(`GET ${OFF_PATH}`, view).install();
  renderApp({ path: `/races/${RACE_ID}/off-track` });
  await screen.findByRole('heading', { level: 2, name: /moments off the track|No moments/ });
  return api;
}

async function stripButton(name: RegExp): Promise<HTMLElement> {
  const strip = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('.strip');
    if (!found) throw new Error('The strip is not drawn yet');
    return found;
  });
  return within(strip).getByRole('button', { name });
}

function cursorLine(): string {
  return document.querySelector('.cursor-line')?.textContent ?? '';
}

describe('race page, off the track tab', () => {
  it('counts_the_moments_and_the_four_wheel_moments', async () => {
    await openOffTrack();
    expect(screen.getByRole('heading', { level: 2, name: '8 moments off the track 3 with all four wheels' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Race' })).getByRole('link', { name: 'Off the track' })).toHaveAttribute('aria-current', 'page');
  });

  it('lists_the_recurring_places_and_the_other_places', async () => {
    await openOffTrack();
    const panel = await screen.findByRole('region', { name: 'Recurring places' });
    expect(panel).toHaveTextContent('The same place in 3 or more laps.');
    const items = within(panel).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('A3,190 m. All four wheels off in 1 lap.Best lap: 89 km/h here. Largest speed loss: 143 km/h.6 of 7');
    expect(items[1]).toHaveTextContent('B3,350 m. Two or three wheels off.Best lap: 89 km/h here. Largest speed loss: 41 km/h.3 of 7');
    expect(panel).toHaveTextContent('2 other places, each in 1 or 2 laps.');
  });

  it('draws_the_marks_and_the_letters_on_the_map', async () => {
    await openOffTrack();
    const map = await screen.findByRole('region', { name: 'Places' });
    expect(map.querySelectorAll('.track-mark.off-all')).toHaveLength(3);
    expect(map.querySelectorAll('.track-mark.off-part')).toHaveLength(5);
    expect([...map.querySelectorAll('.track-mark.place text')].map(text => text.textContent)).toEqual(['A', 'B']);
    expect(within(map).getByText('all four wheels off the track')).toBeInTheDocument();
    expect(within(map).getByText('two or three wheels off')).toBeInTheDocument();
    expect(within(map).getByText('recurring place')).toBeInTheDocument();
  });

  it('marks_the_lap_line_on_the_map_and_in_the_map_view', async () => {
    await openOffTrack();
    const map = await screen.findByRole('region', { name: 'Places' });
    expect([...map.querySelectorAll('.track-label')].map(node => node.textContent)).toEqual(['lap line']);
    await userEvent.click(within(map).getByRole('button', { name: 'View the map in full screen' }));
    expect([...screen.getByRole('dialog').querySelectorAll('.track-label')].map(node => node.textContent)).toEqual(['lap line']);
  });

  it('writes_the_length_in_the_map_view_with_a_thousands_separator', async () => {
    await openOffTrack();
    const map = await screen.findByRole('region', { name: 'Places' });
    await userEvent.click(within(map).getByRole('button', { name: 'View the map in full screen' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Line of the best lap, 6,165 m.');
  });

  it('keeps_start_and_finish_when_the_reference_lap_has_a_pit_stop', async () => {
    const detail = detailWith();
    await openOffTrack({ ...detail, laps: detail.laps.map(lap => (lap.number === detail.referenceLap ? { ...lap, pitIn: true, closed: false } : lap)) });
    const map = await screen.findByRole('region', { name: 'Places' });
    expect([...map.querySelectorAll('.track-label')].map(node => node.textContent)).toEqual(['start', 'finish']);
  });

  it('keeps_start_and_finish_when_the_server_says_that_the_reference_lap_is_not_closed', async () => {
    const detail = detailWith();
    await openOffTrack({ ...detail, laps: detail.laps.map(lap => (lap.number === detail.referenceLap ? { ...lap, closed: false } : lap)) });
    const map = await screen.findByRole('region', { name: 'Places' });
    expect([...map.querySelectorAll('.track-label')].map(node => node.textContent)).toEqual(['start', 'finish']);
  });

  it('keeps_start_and_finish_when_the_reference_lap_is_lap_1', async () => {
    await openOffTrack(detailWith({ referenceLap: 1 }));
    const map = await screen.findByRole('region', { name: 'Places' });
    expect([...map.querySelectorAll('.track-label')].map(node => node.textContent)).toEqual(['start', 'finish']);
  });

  it('shows_the_three_charts_with_one_cursor', async () => {
    await openOffTrack();
    const strip = await screen.findByRole('group', { name: 'Off the track, lap by lap, over the distance from the lap line' });
    expect(strip).toHaveClass('chart-field');
    expect(strip.querySelector('.field-title')!.textContent).toBe('Off the track');
    expect(strip.querySelector('.field-unit')!.textContent).toBe('lap');
    for (const [name, title, unit] of [
      ['Height of the track, m', 'Height of the track', 'm'],
      ['Speed of the best lap, km/h', 'Speed of the best lap', 'km/h']
    ] as const) {
      const field = screen.getByRole('slider', { name }).closest('.chart-field')!;
      expect(field.querySelector('.field-title')!.textContent, name).toBe(title);
      expect(field.querySelector('.field-unit')!.textContent, name).toBe(unit);
    }
    const height = screen.getByRole('slider', { name: 'Height of the track, m' });
    expect(height.closest('.channel')!.querySelector('.channel-label span:last-child')!.textContent).toBe('0 m above the lowest place');
    const speed = screen.getByRole('slider', { name: 'Speed of the best lap, km/h' });
    expect(speed.closest('.channel')!.querySelector('.channel-label span:last-child')!.textContent).toBe('lap 4: 89');
    height.focus();
    await userEvent.setup().keyboard('{End}');
    expect(speed).toHaveAttribute('aria-valuenow', '6165');
    expect(cursorLine()).toMatch(/^Cursor at 6,170 m of 6,170 m\./);
  });

  it('selects_a_moment_by_pointer_and_shows_the_box_on_a_desktop', async () => {
    await openOffTrack();
    fireEvent.click(await stripButton(/^Lap 6, 3,330 m/));
    const box = document.querySelector('.strip-box')!;
    expect([...box.children].map(child => child.textContent)).toEqual(['Lap 6 · 3,330 m', 'All four wheels off for 1.0 s', '104 → 64 km/h']);
    expect(screen.getByRole('slider', { name: 'Speed of the best lap, km/h' })).toHaveAttribute('aria-valuenow', '3334');
    expect(document.querySelector('.track-mark.off-all.selected')).not.toBeNull();
  });

  it('opens_the_box_above_a_moment_in_the_lower_half_of_the_strip', async () => {
    await openOffTrack();
    fireEvent.click(await stripButton(/^Lap 6, 3,330 m/));
    const low = document.querySelector<HTMLElement>('.strip-box')!;
    expect(low).toHaveClass('up');
    expect(low.style.top).toBe('calc(196px)');
    fireEvent.click(await stripButton(/^Lap 1, 5,040 m/));
    const high = document.querySelector<HTMLElement>('.strip-box')!;
    expect(high).not.toHaveClass('up');
    expect(high.style.top).toBe('calc(60px)');
  });

  it('moves_to_the_next_moment_with_the_keyboard', async () => {
    await openOffTrack();
    const first = await stripButton(/^Lap 1, 5,040 m/);
    fireEvent.click(first);
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect((await stripButton(/^Lap 2, 3,190 m/))).toHaveAttribute('aria-pressed', 'true');
    expect((await stripButton(/^Lap 2, 3,190 m/))).toHaveFocus();
    fireEvent.keyDown((await stripButton(/^Lap 2, 3,190 m/)), { key: 'Escape' });
    expect(document.querySelector('.strip-box')).toBeNull();
  });

  it('orders_the_moments_by_lap_then_distance', async () => {
    await openOffTrack();
    const lap6 = await stripButton(/^Lap 6, 3,190 m/);
    fireEvent.click(lap6);
    fireEvent.keyDown(lap6, { key: 'ArrowRight' });
    expect((await stripButton(/^Lap 6, 3,330 m/))).toHaveAttribute('aria-pressed', 'true');
  });

  it('puts_the_facts_in_the_cursor_line_on_a_phone', async () => {
    setViewportWidth(390);
    await openOffTrack();
    fireEvent.click(await stripButton(/^Lap 6, 3,330 m/));
    expect(document.querySelector('.strip-box')).toBeNull();
    expect(cursorLine()).toBe('Cursor at 3,330 m of 6,170 m. Lap 6: all four wheels off for 1.0 s, 104 → 64 km/h.');
  });

  it('phone_shows_heading_map_places_then_charts', async () => {
    setViewportWidth(390);
    await openOffTrack();
    const map = await screen.findByRole('region', { name: 'Places' });
    const places = screen.getByRole('region', { name: 'Recurring places' });
    const height = screen.getByRole('slider', { name: 'Height of the track, m' });
    expect(map.compareDocumentPosition(places) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(places.compareDocumentPosition(height) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says_when_the_race_has_no_moment', async () => {
    const api = await openOffTrack(detailWith({ offTrack: 0, offTrackList: [], recurring: [] }));
    expect(screen.getByRole('heading', { level: 2, name: 'No moments off the track in this race.' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Places' })).not.toBeInTheDocument();
    expect(api.called(`GET ${OFF_PATH}`)).toBe(false);
  });

  it('lists_the_moments_by_lap_when_the_recording_is_gone', async () => {
    await openOffTrack(detailWith(), { status: 409, body: { code: 'raw-missing' } });
    expect(await screen.findByText('The recording of this race is no longer on the disk. The lap table stays.')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Moments by lap' });
    expect(within(list).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual(['Lap 1', 'Lap 2', 'Lap 3', 'Lap 4', 'Lap 6', 'Lap 7']);
    expect(list).toHaveTextContent('3,330 m: all four wheels off for 1.0 s, 104 → 64 km/h');
    expect(screen.queryByRole('region', { name: 'Places' })).not.toBeInTheDocument();
  });

  it('lists_the_moments_when_the_laps_give_no_line', async () => {
    const moments = [offTrackMoment(2, null, 4), offTrackMoment(5, null, 2)];
    await openOffTrack(detailWith({ offTrack: 2, offTrackList: moments, recurring: [] }), { status: 409, body: { code: 'no-match' } });
    expect(await screen.findByText('The laps of this race give no line of the track, so the places cannot be drawn.')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Moments by lap' })).toHaveTextContent('All four wheels off for 1.0 s, 104 → 64 km/h');
    expect(screen.queryByText(/no longer on the disk/)).not.toBeInTheDocument();
  });

  it('names_the_reference_lap_when_it_is_not_the_best_lap', async () => {
    await openOffTrack(detailWith({ referenceLap: 3 }));
    expect(await screen.findByRole('slider', { name: 'Speed of lap 3, km/h' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Recurring places' })).toHaveTextContent('Lap 3: 89 km/h here.');
  });

  it('joins_other_places_across_the_lap_line', async () => {
    const moments = [offTrackMoment(1, 10, 2), offTrackMoment(2, 6160, 2)];
    await openOffTrack(detailWith({ offTrack: 2, offTrackList: moments, recurring: [] }), offTrackView({ moments, recurring: [] }));
    expect(await screen.findByText('1 other place, each in 1 or 2 laps.')).toBeInTheDocument();
  });
});
