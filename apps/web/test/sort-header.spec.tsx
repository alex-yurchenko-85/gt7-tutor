import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SortHeader } from '../src/app/SortHeader.tsx';

describe('sort header', () => {
  it('sort_header_marks_the_active_column', async () => {
    const onTurn = vi.fn();
    const onLost = vi.fn();
    render(
      <div>
        <SortHeader label="Turn" active={false} direction="ascending" onSort={onTurn} />
        <SortHeader label="Time lost" active direction="descending" onSort={onLost} />
      </div>
    );
    const [turn, lost] = screen.getAllByRole('columnheader');
    expect(turn).not.toHaveAttribute('aria-sort');
    expect(lost).toHaveAttribute('aria-sort', 'descending');
    expect(turn!.querySelector('[data-arrow]')).toBeNull();
    expect(lost!.querySelector('[data-arrow="descending"]')).not.toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Turn' }));
    expect(onTurn).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: 'Time lost' }).focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onLost).toHaveBeenCalledTimes(2);
  });

  it('sort_header_points_up_when_ascending', () => {
    render(<SortHeader label="Turn" active direction="ascending" onSort={() => undefined} />);
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('columnheader').querySelector('[data-arrow="ascending"]')).not.toBeNull();
  });
});
