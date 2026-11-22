import { el } from './support.tsx';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChannelChart, type ChartBoxRow } from '../src/charts/ChannelChart.tsx';

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
  return el('[data-chart="speed"]').closest('.channel')!;
}

describe('channel chart', () => {
  it('holds_the_name_the_unit_the_readout_and_both_axes_in_one_field', () => {
    const channel = chart({ title: 'Speed', unit: 'km/h' });
    const field = channel.querySelector('.chart-field')!;
    expect(field.querySelector('.field-title')!.textContent).toBe('Speed');
    expect(field.querySelector('.field-unit')!.textContent).toBe('km/h');
    expect(field.querySelector('.channel-readout')!.textContent).toBe('lap 4 100');
    expect(field.querySelector('.y-axis')).not.toBeNull();
    expect(field.querySelector('.distance-axis')).not.toBeNull();
    expect(screen.queryByText('Speed, km/h')).not.toBeInTheDocument();
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
    expect(screen.getByText('Speed, km/h')).toBeInTheDocument();
  });

  it('draws_a_dashed_cursor_line_and_a_dot_on_each_line_with_a_value', () => {
    render(
      <ChannelChart
        id="speed"
        label="Speed, km/h"
        series={[
          { name: 'ref', values: [100, 120, 140] },
          { name: 'you', values: [null, 110, 130] }
        ]}
        min={0}
        max={200}
        gridM={2}
        lengthM={4}
        cursorSM={0}
        onCursor={() => undefined}
        readout="lap 4 100"
        ticks={[]}
      />
    );
    const plot = el('[data-chart="speed"]');
    expect(plot.querySelector('.chart-cursor')).not.toBeNull();
    expect([...plot.querySelectorAll('.chart-dot')].map(dot => (dot as HTMLElement).style.top)).toEqual(['50%']);
  });
});

describe('channel chart box', () => {
  const ROWS: ChartBoxRow[] = [
    { key: 'ref', tone: 'ref', text: 'Lap 4: 110 km/h' },
    { key: 'you', tone: 'you', text: 'Lap 7: 109 km/h' }
  ];

  function boxChart(cursorSM = 2, box: ChartBoxRow[] | null = ROWS) {
    render(
      <ChannelChart
        id="speed"
        label="Speed, km/h"
        series={[{ name: 'ref', values: [100, 120, 140] }]}
        min={0}
        max={200}
        gridM={1000}
        lengthM={2000}
        cursorSM={cursorSM}
        onCursor={() => undefined}
        readout="lap 4 110, lap 7 109"
        ticks={[]}
        bands={[{ fromSM: 1500, toSM: 2000, label: 'T4' }]}
        field={{ title: 'Speed', unit: 'km/h' }}
        {...(box ? { box } : {})}
      />
    );
    return el('[data-chart="speed"]');
  }

  const shownBox = () => document.querySelector('.chart-box');

  it('shows_the_box_only_while_the_pointer_is_over_the_chart_or_it_has_focus', () => {
    const plot = boxChart();
    expect(shownBox()).toBeNull();
    fireEvent.pointerEnter(plot);
    expect(shownBox()).not.toBeNull();
    fireEvent.pointerLeave(plot);
    expect(shownBox()).toBeNull();
    fireEvent.focus(plot);
    expect(shownBox()).not.toBeNull();
    fireEvent.blur(plot);
    expect(shownBox()).toBeNull();
    fireEvent.pointerEnter(plot);
    act(() => plot.focus());
    fireEvent.pointerLeave(plot);
    expect(shownBox()).toBeNull();
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    expect(shownBox()).not.toBeNull();
  });

  it('gives_the_box_the_distance_the_turn_and_one_row_per_line', () => {
    fireEvent.pointerEnter(boxChart(1800));
    expect(document.querySelector('.chart-box-title')!.textContent).toBe('1,800 m · T4');
    expect([...document.querySelectorAll('.chart-box li')].map(row => row.textContent)).toEqual(['Lap 4: 110 km/h', 'Lap 7: 109 km/h']);
    expect([...document.querySelectorAll('.chart-box li i')].map(swatch => swatch.className)).toEqual(['chart-swatch ref', 'chart-swatch you']);
  });

  it('names_no_turn_outside_a_band', () => {
    fireEvent.pointerEnter(boxChart(1000));
    expect(document.querySelector('.chart-box-title')!.textContent).toBe('1,000 m');
  });

  it('puts_the_box_on_the_side_of_the_cursor_with_more_room', () => {
    const plot = boxChart(400);
    fireEvent.pointerEnter(plot);
    expect(shownBox()).toHaveClass('right');
    fireEvent.pointerLeave(plot);
    document.body.innerHTML = '';
    fireEvent.pointerEnter(boxChart(1600));
    expect(shownBox()).toHaveClass('left');
  });

  it('hides_the_readout_of_a_chart_with_a_box', () => {
    const plot = boxChart();
    expect(plot.closest('.channel')!.querySelector('.channel-readout')).toBeNull();
  });

  it('a_chart_without_box_rows_shows_its_readout_and_no_box', () => {
    const plot = boxChart(2, null);
    fireEvent.pointerEnter(plot);
    expect(shownBox()).toBeNull();
    expect(plot.closest('.channel')!.querySelector('.channel-readout')!.textContent).toBe('lap 4 110, lap 7 109');
  });

  it('keeps_the_box_after_a_finger_lifts_and_hides_it_on_a_touch_elsewhere', () => {
    const plot = boxChart();
    fireEvent.pointerEnter(plot, { pointerType: 'touch' });
    fireEvent.pointerLeave(plot, { pointerType: 'touch' });
    expect(shownBox()).not.toBeNull();
    fireEvent.pointerDown(plot, { pointerType: 'touch' });
    expect(shownBox()).not.toBeNull();
    fireEvent.pointerDown(document.body, { pointerType: 'touch' });
    expect(shownBox()).toBeNull();
  });

  it('clamps_the_box_inside_the_plot_and_drops_columns_that_do_not_fit', () => {
    let plot = 500;
    const listWidth = (list: HTMLElement) => Number(list.style.getPropertyValue('--box-columns')) * 86 - 16;
    const boxWidth = (box: HTMLElement) => {
      const natural = listWidth(box.querySelector('ul')!) + 30;
      return box.style.maxWidth === 'none' ? natural : Math.min(natural, plot - 16);
    };
    const offset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!;
    const client = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!;
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        if (this.classList.contains('chart-box')) return boxWidth(this);
        if (this.tagName === 'UL') return Math.min(listWidth(this), boxWidth(this.parentElement!) - 30);
        return 0;
      }
    });
    Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get(this: Element) { return this.classList.contains('channel-plot') ? plot : 0; } });
    const rows = Array.from({ length: 30 }, (_, index) => ({ key: String(index), tone: 'lap' as const, text: `Lap ${index + 1}: 100 km/h` }));
    const show = () => {
      render(<ChannelChart id="speed" label="Speed, km/h" series={[{ name: 'lap', values: [100, 120, 140] }]} min={0} max={200} gridM={1000} lengthM={2000} cursorSM={900} onCursor={() => undefined} readout="" ticks={[]} box={rows} />);
      fireEvent.pointerEnter(el('[data-chart="speed"]'));
      return document.querySelector('.chart-box') as HTMLElement;
    };
    try {
      const wide = show();
      expect(wide.querySelector('ul')!.style.getPropertyValue('--box-columns')).toBe('4');
      expect(wide.style.left).toBe('134px');
      expect(wide.style.maxWidth).toBe('');
      cleanup();
      plot = 300;
      const narrow = show();
      expect(narrow.querySelector('ul')!.style.getPropertyValue('--box-columns')).toBe('3');
      expect(narrow.style.left).toBe('20px');
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offset);
      Object.defineProperty(Element.prototype, 'clientWidth', client);
    }
  });
});
