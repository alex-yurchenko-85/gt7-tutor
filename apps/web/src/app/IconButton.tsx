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
  return (
    <span className="icon-button-wrap">
      <button
        className={`icon-square${primary ? ' primary' : ''}`}
        type={type}
        aria-pressed={pressed}
        data-primary={primary ? 'true' : undefined}
        disabled={disabled}
        onClick={onClick}
      >
        <Icon name={icon} size={20} />
      </button>
      <span className="icon-tip">
        {label}
      </span>
    </span>
  );
}
