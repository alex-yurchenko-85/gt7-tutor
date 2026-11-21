import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { ProfileCard } from '@gt7/contracts';
import { IconButton } from '../../app/IconButton.tsx';
import { useWideLayout } from '../../app/layout.ts';
import { t } from '../../app/i18n.ts';

const AVATAR_COLORS = ['#14181f', '#1f6fd1', '#b3141d', '#1d7a3a', '#6b3fa0', '#a35a00', '#00727a'];

type ProfileStripProps = {
  profiles: ProfileCard[];
  selected: string | null;
  onSelect(name: string): void;
};

function initialOf(name: string): string {
  return Array.from(name)[0]?.toUpperCase() ?? '';
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}

const STEP_BY_KEY: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function ProfileStrip({ profiles, selected, onSelect }: ProfileStripProps) {
  const wide = useWideLayout();
  const strip = useRef<HTMLDivElement>(null);
  const radios = useRef(new Map<string, HTMLButtonElement>());
  const focusable = selected ?? profiles[0]?.name ?? null;

  useEffect(() => {
    if (selected === null) return;
    radios.current.get(selected)?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: scrollBehavior() });
  }, [selected]);

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = STEP_BY_KEY[event.key];
    if (step === undefined || profiles.length === 0) return;
    event.preventDefault();
    const next = profiles[(index + step + profiles.length) % profiles.length]!;
    onSelect(next.name);
    radios.current.get(next.name)?.focus();
  };

  const page = (direction: 1 | -1) => {
    const element = strip.current;
    if (!element) return;
    element.scrollBy?.({ left: direction * element.clientWidth, behavior: scrollBehavior() });
  };

  const group = (
    <div ref={strip} role="radiogroup" aria-label={t('auth.strip.label')} className="profile-strip">
      {profiles.map((profile, index) => (
        <button
          key={profile.name}
          ref={element => {
            if (element) radios.current.set(profile.name, element);
            else radios.current.delete(profile.name);
          }}
          type="button"
          role="radio"
          aria-checked={profile.name === selected}
          tabIndex={profile.name === focusable ? 0 : -1}
          className="profile-tile"
          onClick={() => onSelect(profile.name)}
          onKeyDown={event => move(event, index)}
        >
          <span className="strip-avatar" style={{ background: AVATAR_COLORS[index % AVATAR_COLORS.length] }} aria-hidden="true">
            {initialOf(profile.name)}
          </span>
          <span className="strip-name">{profile.name}</span>
        </button>
      ))}
    </div>
  );

  if (!wide) return group;
  return (
    <div className="profile-strip-row">
      <IconButton icon="chevron-left" label={t('auth.strip.previous')} onClick={() => page(-1)} />
      {group}
      <IconButton icon="chevron-right" label={t('auth.strip.next')} onClick={() => page(1)} />
    </div>
  );
}
