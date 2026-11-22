import type { KeyboardEvent, ReactNode } from 'react';

export type RadioOption<T> = { value: T; content: ReactNode; title?: string | undefined };

type RadioGroupProps<T> = {
  options: RadioOption<T>[];
  value: T;
  onChange(value: T): void;
  className: string;
};

export function RadioGroup<T extends string | number>({ options, value, onChange, className }: RadioGroupProps<T>) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = options.findIndex(option => option.value === value);
    const nextIndex = (index + step + options.length) % options.length;
    onChange(options[nextIndex]!.value);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus();
  };
  return (
    <div className={className} role="radiogroup" onKeyDown={move}>
      {options.map(option => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            title={option.title}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
          >
            {option.content}
          </button>
        );
      })}
    </div>
  );
}
