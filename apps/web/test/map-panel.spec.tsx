import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MapPanel } from '../src/charts/MapPanel.tsx';

function legendWords(name: string): string[] {
  const panel = screen.getByRole('region', { name });
  return [...panel.querySelectorAll('.legend span')].map(span => span.textContent ?? '');
}

describe('map panel', () => {
  it('legend_has_one_order', () => {
    render(
      <MapPanel title="Your line" legend={['turn', 'you', 'reference']} notes={['A gap in your line is a place without a match']} onView={() => undefined}>
        <svg />
      </MapPanel>
    );
    expect(legendWords('Your line')).toEqual(['reference line', 'you', 'turn', 'A gap in your line is a place without a match']);
  });

  it('legend_names_cues_and_far_parts', () => {
    render(
      <MapPanel title="Reference line, 318 m" legend={['muted', 'cue', 'turn', 'reference']} far="more than 2 m from the line" notes={['Select a number to mute that cue']} onView={() => undefined}>
        <svg />
      </MapPanel>
    );
    expect(legendWords('Reference line, 318 m')).toEqual(['reference line', 'turn', 'voice cue', 'muted cue', 'more than 2 m from the line', 'Select a number to mute that cue']);
  });

  it('view_stands_after_the_actions', () => {
    render(
      <MapPanel title="Your line" legend={['reference']} actions={<button type="button">True scale</button>} onView={() => undefined}>
        <svg />
      </MapPanel>
    );
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['True scale', 'View']);
  });

  it('view_calls_on_view_and_below_stands_before_the_legend', async () => {
    const onView = vi.fn();
    render(
      <MapPanel title="Your line" legend={['reference']} onView={onView} below={<p>Below the map</p>}>
        <svg data-testid="map" />
      </MapPanel>
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'View the map in full screen' }));
    expect(onView).toHaveBeenCalledOnce();
    const below = screen.getByText('Below the map');
    expect(screen.getByTestId('map').compareDocumentPosition(below) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(below.compareDocumentPosition(document.querySelector('.legend')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
