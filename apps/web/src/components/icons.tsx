import type { LegMode } from '@transit/shared-types';
import type { JSX, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const WalkIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="13" cy="4" r="2" />
    <path d="m9 21 2.5-6 2.5 2v4" />
    <path d="m7 11 3-3 3 1 2 3h3" />
    <path d="m11.5 15 1.5-6" />
  </Svg>
);

export const AutoRickshawIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 16v-5a5 5 0 0 1 5-5h6l4 6h2a1 1 0 0 1 1 1v3" />
    <path d="M10 6v10" />
    <path d="M3 16h2m4 0h7m4 0h1" />
    <circle cx="7" cy="17" r="2" />
    <circle cx="18" cy="17" r="2" />
  </Svg>
);

export const ERickshawIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5h11l2 4" />
    <path d="M6 5v9" />
    <path d="M14 9v5" />
    <path d="M3 14h17v-3h-3" />
    <circle cx="6.5" cy="17.5" r="2" />
    <circle cx="17.5" cy="17.5" r="2" />
    <path d="m11 9-1 2h2l-1 2" />
  </Svg>
);

export const TaxiIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 16v-3l2-5h10l2 5v3" />
    <path d="M3 16h18" />
    <path d="M10 5h4" />
    <circle cx="7.5" cy="17.5" r="1.5" />
    <circle cx="16.5" cy="17.5" r="1.5" />
  </Svg>
);

export const MinibusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 16V7a1 1 0 0 1 1-1h11l5 5v5" />
    <path d="M3 11h17" />
    <path d="M9 6v5" />
    <path d="M3 16h2m4 0h6m4 0h1" />
    <circle cx="7" cy="17" r="2" />
    <circle cx="17" cy="17" r="2" />
  </Svg>
);

export const BusIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="3" width="16" height="14" rx="2" />
    <path d="M4 11h16" />
    <path d="M8 21v-2m8 2v-2" />
    <circle cx="8" cy="14" r=".5" />
    <circle cx="16" cy="14" r=".5" />
  </Svg>
);

const MODE_ICONS: Record<LegMode, (p: IconProps) => JSX.Element> = {
  WALK: WalkIcon,
  AUTO_RICKSHAW: AutoRickshawIcon,
  E_RICKSHAW: ERickshawIcon,
  SHARED_TAXI: TaxiIcon,
  MINIBUS: MinibusIcon,
  BUS: BusIcon,
};

export function ModeIcon({ mode, ...p }: IconProps & { mode: LegMode }) {
  const Icon = MODE_ICONS[mode];
  return <Icon {...p} />;
}

export const LocateIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
  </Svg>
);

export const SwapIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 4v16m0 0-3-3m3 3 3-3" />
    <path d="M17 20V4m0 0-3 3m3-3 3 3" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);

export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

export const PinIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12Z" />
    <circle cx="12" cy="9" r="2.5" />
  </Svg>
);

export const HistoryIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

export const OfflineIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m2 2 20 20" />
    <path d="M8.5 16.5a5 5 0 0 1 7 0" />
    <path d="M2 8.8a15 15 0 0 1 4.2-2.6m4.3-.9A15 15 0 0 1 22 8.8" />
    <path d="M5 12.6a10 10 0 0 1 5.2-2.6m4.4.3a10 10 0 0 1 4.4 2.3" />
    <path d="M12 20h.01" />
  </Svg>
);

export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v12m0 0-4-4m4 4 4-4" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </Svg>
);

export const ShareIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v12" />
    <path d="m8 7 4-4 4 4" />
    <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </Svg>
);
