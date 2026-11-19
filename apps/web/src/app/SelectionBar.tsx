type SelectionBarProps = { count: number; action: string; onCancel(): void; onAction(): void };

export function SelectionBar({ count, action, onCancel, onAction }: SelectionBarProps) {
  return (
    <div className="selection-bar" role="region" aria-label="Selection">
      <b className="selection-count">{count} selected</b>
      <button type="button" className="btn inline selection-cancel" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" className="btn inline selection-delete" onClick={onAction} disabled={count === 0}>
        {action}
      </button>
    </div>
  );
}
