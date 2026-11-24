import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SelectionBar } from '../src/app/SelectionBar.tsx';
import { setViewportWidth } from './support.tsx';

describe('selection bar', () => {
  it('a_phone_shows_a_short_delete_label', () => {
    setViewportWidth(390);
    render(<SelectionBar count={12} action="Delete 12 exercises" onCancel={() => undefined} onAction={() => undefined} />);
    expect(screen.getByText('12 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
    expect(screen.queryByText('Delete 12 exercises')).toBeNull();
  });

  it('a_computer_shows_the_full_delete_label', () => {
    setViewportWidth(1440);
    render(<SelectionBar count={12} action="Delete 12 exercises" onCancel={() => undefined} onAction={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Delete 12 exercises' })).toBeEnabled();
  });
});
