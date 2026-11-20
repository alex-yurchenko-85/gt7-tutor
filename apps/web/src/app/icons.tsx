import type { ReactNode } from 'react';

export type IconName =
  | 'list'
  | 'drive'
  | 'gear'
  | 'monitor'
  | 'sun'
  | 'moon'
  | 'expand'
  | 'undo'
  | 'search'
  | 'profiles'
  | 'speaker'
  | 'speaker-off'
  | 'play'
  | 'sign-out'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'check'
  | 'refresh'
  | 'select';

const GEAR =
  'M18.80 10.34 L21.49 10.57 L21.49 13.43 L18.80 13.66 L17.98 15.63 L19.73 17.70 L17.70 19.73 L15.63 17.98 L13.66 18.80 L13.43 21.49 L10.57 21.49 L10.34 18.80 L8.37 17.98 L6.30 19.73 L4.27 17.70 L6.02 15.63 L5.20 13.66 L2.51 13.43 L2.51 10.57 L5.20 10.34 L6.02 8.37 L4.27 6.30 L6.30 4.27 L8.37 6.02 L10.34 5.20 L10.57 2.51 L13.43 2.51 L13.66 5.20 L15.63 6.02 L17.70 4.27 L19.73 6.30 L17.98 8.37 Z';

const SHAPES: Record<IconName, ReactNode> = {
  list: <path d="M4 6h16M4 12h16M4 18h10" />,
  drive: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 3v7M4.5 16l6-3M19.5 16l-6-3" />
    </>
  ),
  gear: (
    <>
      <path d={GEAR} strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  undo: (
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 010 12h-3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </>
  ),
  profiles: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11l2 2 4-4" />
    </>
  ),
  speaker: <path d="M11 5L6 9H2v6h4l5 4V5zM16 9a4 4 0 010 6" />,
  'speaker-off': <path d="M11 5L6 9H2v6h4l5 4V5zM16 9l6 6M22 9l-6 6" />,
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" />,
  'sign-out': <path d="M9 21H4V3h5M16 17l5-5-5-5M21 12H9" />,
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  select: (
    <>
      <rect x="4" y="4" width="16" height="16" />
      <path d="M8 12l3 3 5-6" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>
  )
};

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      data-icon={name}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  );
}
