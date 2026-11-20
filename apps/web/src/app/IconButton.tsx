import { useId } from 'react';
import { Icon, type IconName } from './icons.tsx';

type IconButtonProps = {
  icon: IconName;
  label: string;
  primary?: boolean;
  pressed?: boolean;
  type?: 'button' | 'submit';
  onClick?(): void;
  disabled?: boolean;
};

export function IconButton({ icon, label, primary = false, pressed, type = 'button', onClick, disabled = false }: IconButtonProps) {
  const tipId = useId();
  return (
    <span className="icon-button-wrap">
      <button
        className={`icon-square${primary ? ' primary' : ''}`}
        type={type}
        aria-labelledby={tipId}
        aria-pressed={pressed}
        data-primary={primary ? 'true' : undefined}
        disabled={disabled}
        onClick={onClick}
      >
        <Icon name={icon} size={20} />
      </button>
      <span className="icon-tip" id={tipId} role="tooltip">
        {label}
      </span>
    </span>
  );
}
