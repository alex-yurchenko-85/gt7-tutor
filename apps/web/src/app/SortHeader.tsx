type SortHeaderProps = { label: string; active: boolean; direction: 'ascending' | 'descending'; onSort(): void };

const ARROW = { ascending: 'M12 19V5M6 11l6-6 6 6', descending: 'M12 5v14M6 13l6 6 6-6' };

export function SortHeader({ label, active, direction, onSort }: SortHeaderProps) {
  return (
    <span className="sort-header" role="columnheader" aria-sort={active ? direction : undefined}>
      <button type="button" className="sort-button" onClick={onSort}>
        {label}
        {active ? (
          <svg data-arrow={direction} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
            <path d={ARROW[direction]} />
          </svg>
        ) : null}
      </button>
    </span>
  );
}
