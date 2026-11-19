import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from '../src/app/IconButton.tsx';

describe('icon button', () => {
  it('icon_button_has_name_and_tooltip', async () => {
    const onClick = vi.fn();
    render(<IconButton icon="check" label="Save and check" primary onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Save and check' });
    expect(button.textContent).toBe('');
    expect(button.querySelector('[data-icon="check"]')).not.toBeNull();
    expect(button).toHaveAttribute('data-primary', 'true');
    expect(button).not.toHaveAttribute('aria-describedby');
    expect(button).not.toHaveAccessibleDescription();
    const tip = document.getElementById(button.getAttribute('aria-labelledby')!);
    expect(tip).toHaveTextContent('Save and check');
    expect(tip).toHaveAttribute('role', 'tooltip');
    await userEvent.setup().click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('icon_button_submits_a_form_when_asked', () => {
    render(
      <form aria-label="f">
        <IconButton icon="check" label="Save" type="submit" />
      </form>
    );
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'submit');
  });
});
