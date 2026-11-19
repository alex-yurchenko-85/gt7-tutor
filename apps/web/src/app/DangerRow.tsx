type DangerRowProps = { title: string; hint: string; action: string; onAction(): void };

export function DangerRow({ title, hint, action, onAction }: DangerRowProps) {
  return (
    <div className="danger-row">
      <b className="danger-row-title">{title}</b>
      <span className="sub danger-row-hint">{hint}</span>
      <button type="button" className="text-button danger" onClick={onAction}>
        {action}
      </button>
    </div>
  );
}
