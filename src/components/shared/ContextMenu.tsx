import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useIsMobileViewport } from "../../hooks/use-media-query";

export interface ContextMenuItem {
  label: string;
  icon?: React.ElementType;
  /** Leaf action. Omitted for items that only open a `submenu`. */
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Render a separator line above this item */
  separator?: boolean;
  /** Nested items — turns this row into a flyout submenu. */
  submenu?: ContextMenuItem[];
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

// ─── Viewport-aware positioning ───────────────────────────────────────────────

const VIEWPORT_MARGIN = 8; // min gap between menu and viewport edge

// ─── Item ──────────────────────────────────────────────────────────────────────

function MenuRow({
  item,
  onClose,
  sheet = false,
}: {
  item: ContextMenuItem;
  onClose: () => void;
  /** Bottom-sheet mode: taller rows, submenus expand inline. */
  sheet?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const [subShiftY, setSubShiftY] = useState(0);
  const hasSubmenu = !!item.submenu && item.submenu.length > 0;
  const Icon = item.icon;

  // Position the flyout from its rendered size (before paint): open to the left
  // when it would overflow the right viewport edge, shift up when it would
  // overflow the bottom.
  useLayoutEffect(() => {
    // Sheet submenus expand inline, so there is no flyout to place.
    if (sheet) return;
    if (!open || !ref.current || !subRef.current) return;
    const rowRect = ref.current.getBoundingClientRect();
    const subRect = subRef.current.getBoundingClientRect();
    // Flip left only when the flyout actually fits there; when neither side
    // fits (narrow window, wide submenu) stay right so the near edge — where
    // the cursor is — remains on-screen.
    const fitsRight = rowRect.right + subRect.width <= window.innerWidth - VIEWPORT_MARGIN;
    const fitsLeft = rowRect.left - subRect.width >= VIEWPORT_MARGIN;
    setFlip(!fitsRight && fitsLeft);
    const overflowY = rowRect.top + subRect.height - (window.innerHeight - VIEWPORT_MARGIN);
    setSubShiftY(overflowY > 0 ? -overflowY : 0);
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative"
      // Hover-to-open is a pointer affordance; in sheet mode the row is tapped.
      onMouseEnter={() => !sheet && hasSubmenu && setOpen(true)}
      onMouseLeave={() => !sheet && hasSubmenu && setOpen(false)}
    >
      {item.separator && <div className="h-px bg-border my-1" role="separator" />}
      <button
        role="menuitem"
        aria-haspopup={hasSubmenu || undefined}
        aria-expanded={hasSubmenu ? open : undefined}
        disabled={item.disabled}
        onClick={() => {
          if (item.disabled) return;
          if (hasSubmenu) {
            setOpen((o) => !o);
            return;
          }
          item.onClick?.();
          onClose();
        }}
        className={[
          "w-full flex items-center gap-2",
          // 44px is the minimum comfortable touch target (WCAG 2.5.5 / the
          // Android and iOS HIG both land on ~48dp/44pt). The desktop row stays
          // compact — a mouse does not need the extra area, and inflating it
          // would make long menus overflow the viewport.
          sheet
            ? "min-h-[44px] px-4 py-2.5 text-[length:var(--text-base)]"
            : "px-3 py-1.5 text-[length:var(--text-sm)]",
          "text-left cursor-pointer",
          "transition-colors duration-[var(--duration-fast)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          item.disabled
            ? "opacity-40 pointer-events-none"
            : item.danger
              ? "text-status-error hover:bg-status-error/10 active:bg-status-error/15"
              : "text-text-primary hover:bg-bg-subtle active:bg-bg-subtle",
        ].join(" ")}
      >
        {Icon && (
          <Icon
            size={sheet ? 18 : 15}
            strokeWidth={1.8}
            aria-hidden="true"
            className={item.danger ? "text-status-error" : "text-text-muted"}
          />
        )}
        <span className="flex-1 truncate">{item.label}</span>
        {hasSubmenu && (
          <ChevronRight
            size={sheet ? 16 : 14}
            strokeWidth={1.8}
            aria-hidden="true"
            className={[
              "-mr-1 text-text-muted transition-transform duration-[var(--duration-fast)]",
              // Inline expansion reads as a disclosure, so the chevron turns
              // down rather than pointing at a flyout that isn't there.
              sheet && open ? "rotate-90" : "",
            ].join(" ")}
          />
        )}
      </button>

      {hasSubmenu &&
        open &&
        (sheet ? (
          // Inline disclosure. A flyout would need horizontal room the phone
          // does not have, and hovering to keep it open is impossible on touch.
          <div role="menu" className="bg-bg-subtle/40">
            {item.submenu!.map((sub, i) => (
              <div key={i} className="pl-4">
                <MenuRow item={sub} onClose={onClose} sheet />
              </div>
            ))}
          </div>
        ) : (
          <div
            ref={subRef}
            role="menu"
            style={{ top: subShiftY }}
            className={[
              // w-max: size to content — the row's containing block offers ~zero
              // width at left:100%, which would otherwise wrap long labels.
              "absolute z-10 py-1 w-max min-w-[160px]",
              flip ? "right-full mr-0.5" : "left-full ml-0.5",
              "bg-bg-overlay border border-border rounded-lg",
              "shadow-[var(--shadow-lg)]",
              // See root menu: transition-none keeps the flip/shift placement
              // from animating as a slide while preserving the entrance animation.
              "transition-none animate-in fade-in-0 zoom-in-95 duration-[var(--duration-fast)]",
            ].join(" ")}
          >
            {item.submenu!.map((sub, i) => (
              <MenuRow key={i} item={sub} onClose={onClose} />
            ))}
          </div>
        ))}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  // Clamped coordinates, computed from the menu's rendered size. Until they
  // are known the menu renders hidden at the cursor — never at the origin, so
  // a stray paint of the measuring frame can't flash or slide from top-left.
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);

  // A cursor-anchored popover is the wrong shape on a phone: there is no
  // cursor, and a menu pinned to where the finger happened to land ends up
  // under the thumb that opened it. Below the `sm` breakpoint the same items
  // render as a bottom sheet instead — thumb-reachable and full-width.
  //
  // Read once per open rather than tracked reactively: the menu closes on
  // `resize` (see below), so it cannot outlive a viewport change.
  const isSheet = useIsMobileViewport();

  useLayoutEffect(() => {
    if (isSheet) return; // the sheet is CSS-positioned; nothing to measure
    const el = menuRef.current;
    if (!el) return;
    // w-max on the container means the measured size is its natural content
    // size no matter where the menu currently sits (no shrink-to-fit at the
    // viewport edge), so one measurement here is accurate.
    const rect = el.getBoundingClientRect();
    setCoords({
      x: Math.max(VIEWPORT_MARGIN, Math.min(position.x, window.innerWidth - rect.width - VIEWPORT_MARGIN)),
      y: Math.max(VIEWPORT_MARGIN, Math.min(position.y, window.innerHeight - rect.height - VIEWPORT_MARGIN)),
    });
  }, [position.x, position.y, isSheet]);

  // Close on outside click or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };

    // Use capture so we catch clicks that land on other interactive elements
    document.addEventListener("mousedown", handleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);

    // Clicks on native window chrome (titlebar, traffic lights) and focus moves
    // to other apps never reach the document, so the menu would otherwise stick
    // around — e.g. surviving a fullscreen toggle. Blur/resize cover those.
    //
    // Neither applies to the sheet, and on Android both actively misfire: the
    // webview blurs and resizes for soft-keyboard and system-UI changes the
    // user did not initiate, which would make the sheet vanish on its own. The
    // sheet is also CSS-positioned, so unlike the popover it stays correct at
    // any viewport size and has nothing to recompute.
    if (!isSheet) {
      window.addEventListener("blur", onClose);
      window.addEventListener("resize", onClose);
    }

    return () => {
      document.removeEventListener("mousedown", handleClick, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose, isSheet]);

  if (isSheet) {
    return (
      <>
        {/* Scrim. Tapping it dismisses — the expected way out of a sheet, and
            it also blocks stray taps on the list underneath. */}
        <div
          className="fixed inset-0 z-40 bg-black/40 animate-in fade-in-0 duration-[var(--duration-fast)]"
          aria-hidden="true"
          onClick={onClose}
        />
        <div
          ref={menuRef}
          role="menu"
          aria-label="Context menu"
          className={[
            "fixed inset-x-0 bottom-0 z-50 pt-1",
            // Clear the gesture bar / rounded corners. env() is 0 where the
            // inset does not apply, so this is safe on every device.
            "pb-[max(0.5rem,env(safe-area-inset-bottom))]",
            "bg-bg-overlay border-t border-border rounded-t-2xl",
            "shadow-[var(--shadow-lg)]",
            // Long menus must not grow past the screen; the list scrolls and
            // overscroll is contained so the page behind cannot chain-scroll.
            "max-h-[70vh] overflow-y-auto overscroll-contain",
            "animate-in slide-in-from-bottom duration-[var(--duration-fast)]",
          ].join(" ")}
        >
          {/* Grab handle: the conventional affordance that marks a sheet. */}
          <div
            className="mx-auto mb-1 h-1 w-9 shrink-0 rounded-full bg-border"
            aria-hidden="true"
          />
          {items.map((item, index) => (
            <MenuRow key={index} item={item} onClose={onClose} sheet />
          ))}
        </div>
      </>
    );
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Context menu"
      style={
        coords
          ? { left: coords.x, top: coords.y }
          : { left: position.x, top: position.y, visibility: "hidden" }
      }
      className={[
        "fixed z-50 py-1 w-max min-w-[160px]",
        "bg-bg-overlay border border-border rounded-lg",
        "shadow-[var(--shadow-lg)]",
        // transition-none matters: `duration-*` also sets transition-duration,
        // and with `transition-property` defaulting to `all` the measured
        // left/top placement would render as a visible slide across the screen.
        "transition-none animate-in fade-in-0 zoom-in-95 duration-[var(--duration-fast)]",
      ].join(" ")}
    >
      {items.map((item, index) => (
        <MenuRow key={index} item={item} onClose={onClose} />
      ))}
    </div>
  );
}
