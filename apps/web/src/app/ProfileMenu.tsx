import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from './icons.tsx';
import { Link, paths } from './router.tsx';
import { useSession } from './session.tsx';
import { ThemeSwitch } from './ThemeSwitch.tsx';

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return menu ? [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')] : [];
}

export function ProfileMenu() {
  const { user, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    menuItems(menu.current)[0]?.focus();
    const outside = (event: PointerEvent | MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if ((event.target as HTMLElement).getAttribute('role') === 'radio') return;
    const items = menuItems(menu.current);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    event.preventDefault();
    items[(index + step + items.length) % items.length]?.focus();
  };

  return (
    <div className="profile-menu" ref={container} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="profile-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Profile ${user.name}`}
        onClick={() => setOpen(value => !value)}
      >
        <span className="profile-initial" aria-hidden="true">
          {user.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="profile-name">{user.name}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      {open ? (
        <div ref={menu} id={menuId} className="profile-popup" role="menu" aria-label={`Profile ${user.name}`}>
          <div className="profile-head">
            <b>{user.name}</b>
            <span>Signed in on this device</span>
          </div>
          <Link to={paths.setup('profiles')} className="menu-item" role="menuitem" onNavigate={() => setOpen(false)}>
            <Icon name="profiles" size={18} />
            Manage profiles
          </Link>
          <Link to={paths.setup('voice')} className="menu-item" role="menuitem" onNavigate={() => setOpen(false)}>
            <Icon name="speaker" size={18} />
            Voice on this device
          </Link>
          <div className="menu-theme">
            <span>Theme</span>
            <ThemeSwitch compact />
          </div>
          <button type="button" className="menu-item strong" role="menuitem" onClick={() => void signOut()}>
            <Icon name="sign-out" size={18} />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
