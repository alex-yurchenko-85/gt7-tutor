import { iconButton } from './support.tsx';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from '../src/app/IconButton.tsx';

describe('icon button', () => {
  it('icon_button_has_name_and_tooltip', async () => {
    const onClick = vi.fn();
    render(<IconButton icon="check" label="Save and check" primary onClick={onClick} />);
    const button = iconButton('Save and check');
    expect(button.textContent).toBe('');
    expect(button.querySelector('[data-icon="check"]')).not.toBeNull();
    expect(button).toHaveAttribute('data-primary', 'true');
    expect(button).not.toHaveAttribute('title');
    expect(button.closest('.icon-button-wrap')!.querySelector('.icon-tip')).toHaveTextContent('Save and check');
    await userEvent.setup().click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('icon_button_submits_a_form_when_asked', () => {
    render(
      <form>
        <IconButton icon="check" label="Save" type="submit" />
      </form>
    );
    expect(iconButton('Save')).toHaveAttribute('type', 'submit');
  });
});
