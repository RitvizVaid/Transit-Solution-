import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useMediaQuery } from '../hooks/useBrowser';

export type Snap = 'peek' | 'half' | 'full';
const ORDER: Snap[] = ['peek', 'half', 'full'];

interface Props {
  snap: Snap;
  onSnapChange: (snap: Snap) => void;
  /** Always visible, even at `peek` (search inputs, tabs). */
  header: ReactNode;
  children: ReactNode;
  label: string;
}

const HANDLE_PX = 22;

/**
 * Mobile: a draggable sheet over the map with three snap points.
 * Wide screens (≥ 768 px): a fixed side panel; `snap` is ignored.
 */
export function BottomSheet({ snap, onSnapChange, header, children, label }: Props) {
  const isWide = useMediaQuery('(min-width: 768px)');
  if (isWide) {
    return (
      <aside
        aria-label={label}
        className="absolute top-4 bottom-4 left-4 z-20 flex w-[400px] flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-900/5"
      >
        <div className="shrink-0 border-b border-slate-100 px-4 pt-4 pb-3">{header}</div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </aside>
    );
  }
  return (
    <MobileSheet snap={snap} onSnapChange={onSnapChange} header={header} label={label}>
      {children}
    </MobileSheet>
  );
}

function useViewportHeight() {
  const [h, setH] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => setH(window.visualViewport?.height ?? window.innerHeight);
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, []);
  return h;
}

function MobileSheet({ snap, onSnapChange, header, children, label }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(160);
  const vh = useViewportHeight();

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight));
    ro.observe(el);
    setHeaderH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  const full = Math.round(vh * 0.92);
  const peek = Math.min(HANDLE_PX + headerH + 12, full);
  const half = Math.max(peek, Math.round(vh * 0.55));
  const heights: Record<Snap, number> = { peek, half, full };

  const drag = useRef<{
    startY: number;
    startH: number;
    lastY: number;
    lastT: number;
    v: number;
    moved: boolean;
  } | null>(null);

  const setHeight = (px: number, animate: boolean) => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transition = animate ? '' : 'none';
    el.style.height = `${px}px`;
  };

  const cycle = useCallback(
    (dir: 1 | -1) => {
      const i = ORDER.indexOf(snap);
      const next = ORDER[Math.min(ORDER.length - 1, Math.max(0, i + dir))] ?? snap;
      onSnapChange(next);
    },
    [snap, onSnapChange],
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      startY: e.clientY,
      startH: sheetRef.current?.offsetHeight ?? heights[snap],
      lastY: e.clientY,
      lastT: e.timeStamp,
      v: 0,
      moved: false,
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (Math.abs(dy) > 4) d.moved = true;
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.v = (e.clientY - d.lastY) / dt; // px/ms, + = downward
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    setHeight(Math.min(full, Math.max(peek - 40, d.startH - dy)), false);
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (sheetRef.current) sheetRef.current.style.transition = '';
    if (!d.moved) {
      // Tap on the handle: peek → half → full → half.
      onSnapChange(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'half');
      return;
    }
    const current = sheetRef.current?.offsetHeight ?? heights[snap];
    const projected = current - d.v * 220; // fling
    const nearest = ORDER.reduce((best, s) =>
      Math.abs(heights[s] - projected) < Math.abs(heights[best] - projected) ? s : best,
    );
    setHeight(heights[nearest], true);
    onSnapChange(nearest);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      cycle(1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      cycle(-1);
    }
  };

  return (
    <section
      ref={sheetRef}
      aria-label={label}
      style={{ height: heights[snap] }}
      className="fixed inset-x-0 bottom-0 z-20 flex flex-col rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_40px_-12px_rgba(15,23,42,0.35)] transition-[height] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none"
    >
      <div
        className="flex h-[22px] shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <button
          type="button"
          aria-label={snap === 'full' ? 'Collapse panel' : 'Expand panel'}
          aria-expanded={snap !== 'peek'}
          onKeyDown={onKeyDown}
          // Pointer taps are handled above; this handles Enter / Space only.
          onClick={(e) => e.detail === 0 && cycle(snap === 'full' ? -1 : 1)}
          className="h-[22px] w-16 rounded-full focus-visible:outline-2 focus-visible:outline-teal-700"
        >
          <span className="mx-auto block h-1.5 w-10 rounded-full bg-slate-300" />
        </button>
      </div>
      <div ref={headerRef} className="shrink-0 px-4 pb-3">
        {header}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-slate-100">
        {children}
      </div>
    </section>
  );
}
