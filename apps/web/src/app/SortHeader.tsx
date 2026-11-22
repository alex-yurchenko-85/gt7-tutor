import { useState } from 'react';

export type SortDirection = 'ascending' | 'descending';

export type SortBinding = { active: boolean; direction: SortDirection; onSort(): void };

type SortHeaderProps = SortBinding & { label: string };

type SortState<C extends string> = { column: C; direction: SortDirection };

export function useSort<C extends string>(defaults: Record<C, SortDirection>, initial: NoInfer<C>) {
  const [state, setState] = useState<SortState<C>>({ column: initial, direction: defaults[initial] });
  const sortBy = (column: C) =>
    setState(current =>
      current.column === column ? { column, direction: current.direction === 'ascending' ? 'descending' : 'ascending' } : { column, direction: defaults[column] }
    );
  const header = (column: C): SortBinding => ({ active: state.column === column, direction: state.direction, onSort: () => sortBy(column) });
  return { ...state, header };
}

const ARROW = { ascending: 'M12 19V5M6 11l6-6 6 6', descending: 'M12 5v14M6 13l6 6 6-6' };

export function SortHeader({ label, active, direction, onSort }: SortHeaderProps) {
  return (
    <span className="sort-header" role="columnheader" aria-sort={active ? direction : undefined}>
      <button type="button" className="sort-button" onClick={onSort}>
        {label}
        {active ? (
          <svg data-arrow={direction} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d={ARROW[direction]} />
          </svg>
        ) : null}
      </button>
    </span>
  );
}
