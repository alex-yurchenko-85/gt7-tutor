import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { startLanguage } from '../src/app/i18n.ts';
import { Rich } from '../src/app/rich-text.tsx';

describe('rich text', () => {
  afterEach(() => startLanguage('', null));

  it('puts_elements_in_the_place_of_their_placeholders', () => {
    const { container } = render(<p><Rich k="setup.console.demo-start" parts={{ command: <code>./start.sh</code> }} /></p>);
    expect(container.querySelector('p')?.innerHTML).toBe('No PS5 is needed. To connect your own console, stop the demo and start GT7 Tutor with <code>./start.sh</code>.');
  });

  it('fills_the_values_and_keeps_the_plural', () => {
    const one = render(<p><Rich k="exercises.delete.attempts" params={{ count: 1 }} parts={{ attempts: <b>1 attempt</b> }} /></p>);
    expect(one.container.textContent).toBe('1 attempt, with its cues and differences');
    const many = render(<p><Rich k="exercises.delete.attempts" params={{ count: 3 }} parts={{ attempts: <b>3 attempts</b> }} /></p>);
    expect(many.container.querySelector('b')?.textContent).toBe('3 attempts');
    expect(many.container.textContent).toBe('3 attempts, with their cues and differences');
  });

  it('keeps_braces_inside_a_value', () => {
    const { container } = render(<p><Rich k="setup.history.profile-only" parts={{ name: <b>{'{name}'}</b> }} /></p>);
    expect(container.textContent).toBe('This affects the profile {name} only. It cannot be undone.');
    const value = render(<p><Rich k="exercises.history" params={{ references: '{attempts}' }} parts={{ attempts: <b>3 attempts</b> }} /></p>);
    expect(value.container.textContent).toBe('3 attempts, {attempts}');
    expect(value.container.querySelectorAll('b')).toHaveLength(1);
  });
});
