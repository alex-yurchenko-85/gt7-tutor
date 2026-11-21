import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChannelChart } from '../src/charts/ChannelChart.tsx';

function chart(field?: { title: string | null; unit: string | null }) {
  render(
    <ChannelChart
      id="speed"
      label="Speed, km/h"
      series={[{ name: 'ref', values: [100, 120, 140] }]}
      min={0}
      max={200}
      gridM={2}
      lengthM={4}
      cursorSM={0}
      onCursor={() => undefined}
      readout="lap 4 100"
      ticks={[{ value: 100, label: '100' }]}
      {...(field ? { field } : {})}
    />
  );
  return screen.getByRole('slider', { name: 'Speed, km/h' }).closest('.channel')!;
}

describe('channel chart', () => {
  it('holds_the_name_the_unit_the_readout_and_both_axes_in_one_field', () => {
    const channel = chart({ title: 'Speed', unit: 'km/h' });
    const field = channel.querySelector('.chart-field')!;
    expect(field.querySelector('.field-title')!.textContent).toBe('Speed');
    expect(field.querySelector('.field-unit')!.textContent).toBe('km/h');
    expect(field.querySelector('.channel-label span:last-child')!.textContent).toBe('lap 4 100');
    expect(field.querySelector('.y-axis')).not.toBeNull();
    expect(field.querySelector('.distance-axis')).not.toBeNull();
    expect(screen.getByText('Speed, km/h')).toHaveClass('visually-hidden');
  });

  it('shows_no_name_when_the_field_has_none', () => {
    const channel = chart({ title: null, unit: 'km/h' });
    expect(channel.querySelector('.field-title')).toBeNull();
    expect(channel.querySelector('.field-unit')!.textContent).toBe('km/h');
  });

  it('keeps_the_chart_without_a_field_as_before', () => {
    const channel = chart();
    expect(channel.querySelector('.chart-field')).toBeNull();
    expect(channel.querySelector('.field-unit')).toBeNull();
    expect(screen.getByText('Speed, km/h')).not.toHaveClass('visually-hidden');
  });
});
