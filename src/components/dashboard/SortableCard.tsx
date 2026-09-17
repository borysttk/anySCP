import type { CSSProperties, ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useIsMobileViewport } from "../../hooks/use-media-query";

interface SortableCardProps {
  id: string;
  children: ReactNode;
}

/**
 * Generic drag-and-drop wrapper for dashboard cards (hosts, groups, S3) — one
 * shell replacing three near-identical per-card wrappers. `attributes` wires
 * keyboard accessibility (focusable + ARIA); `listeners` the pointer/keyboard
 * drag gestures. We render only the visual feedback (lift + dim) while
 * dragging — @dnd-kit drives the actual position.
 *
 * ## Why the drag surface differs by input type
 *
 * On pointer devices the whole card is draggable: the sensors require a ~5px
 * move before a drag begins, so a plain click still reaches the card's own
 * actions, and right-click remains available for the context menu.
 *
 * Touch has no equivalent escape hatch. The TouchSensor claims the gesture
 * after a 250ms hold, which is *shorter* than the 500ms long-press that opens
 * the context menu — so on a phone a whole-card drag surface makes the menu
 * unreachable: every hold turns into a reorder.
 *
 * Rather than tuning two thresholds against each other (fragile, and a
 * near-miss silently does the wrong thing), touch gets an explicit drag handle.
 * Dragging and "open the menu" become distinct targets, so neither gesture has
 * to guess at intent. The card body is then free for long-press, which
 * `ContextMenu` renders as a bottom sheet.
 */
export function SortableCard({ id, children }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const isMobile = useIsMobileViewport();

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Lift the dragged card above its neighbours and dim it so the drop target
    // reads clearly. @dnd-kit drives the position; we only style the feedback.
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  if (isMobile) {
    return (
      // pl-11 opens a gutter the handle lives in, so the handle never overlaps
      // the card's own content or its top-right action strip.
      <div
        ref={setNodeRef}
        style={style}
        className="relative h-full pl-11"
        {...attributes}
      >
        {children}

        {/*
          Handle only — `listeners` are NOT spread on the card body, which is
          what frees the body for long-press. touch-none keeps the browser from
          scrolling the page once the drag starts.

          Left gutter, full card height: a 44px-wide strip (WCAG 2.5.5) that is
          easy to hit with a thumb. It must NOT go top-right: the cards render a
          CardActionStrip at `top-2 right-2`, and a 44x44 handle at `top-0
          right-0` would sit straight on top of its rightmost button (Explorer
          on HostCard, Edit on S3Card), swallowing those taps.
        */}
        <button
          type="button"
          aria-label="Reorder — drag to move"
          className="absolute left-0 top-0 bottom-0 z-10 flex w-11 touch-none items-center justify-center text-text-muted active:text-text-primary"
          {...listeners}
        >
          <GripVertical size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      // touch-none lets the TouchSensor own the gesture once a drag begins
      // instead of the browser scrolling the page.
      className="relative h-full touch-none"
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}
