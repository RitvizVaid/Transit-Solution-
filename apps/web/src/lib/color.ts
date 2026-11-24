/** Parses #rgb / #rrggbb. Returns null for anything else. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Black or white, whichever has more contrast on `background` (WCAG relative luminance). */
export function readableTextColor(background: string): '#0f172a' | '#ffffff' {
  const rgb = parseHex(background);
  if (!rgb) return '#ffffff';
  const l = luminance(rgb);
  const onWhite = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / (0.0099 + 0.05); // #0f172a luminance ≈ 0.0099
  return onDark > onWhite ? '#0f172a' : '#ffffff';
}

/** Fallback route colour when the feed has none. */
export const DEFAULT_ROUTE_COLOR = '#0f766e';
