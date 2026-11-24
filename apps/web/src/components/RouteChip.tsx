import type { LegMode } from '@transit/shared-types';
import { DEFAULT_ROUTE_COLOR, readableTextColor } from '../lib/color';
import { MODE_META } from '../lib/format';
import { ModeIcon } from './icons';

/** Coloured badge for a line, e.g. [auto icon] KG-1. */
export function RouteChip({ mode, name, color }: { mode: LegMode; name?: string; color?: string }) {
  const bg = color ?? DEFAULT_ROUTE_COLOR;
  return (
    <span
      className="inline-flex max-w-[9rem] items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-semibold"
      style={{ backgroundColor: bg, color: readableTextColor(bg) }}
    >
      <ModeIcon mode={mode} size={16} />
      <span className="sr-only">{MODE_META[mode].label}</span>
      {name && <span className="truncate">{name}</span>}
    </span>
  );
}
