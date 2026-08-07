"use client";

import {
  useCallback,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/shared/utils/cn";

/**
 * AppleCard — fluid-interface card with spring hover, press, and spotlight.
 *
 * Design intent (from apple-design skill):
 * - Hover lifts the card 2px and warms the shadow — the most direct
 *   "this is interactive" signal in Apple's UI.
 * - Active state compresses (scale 0.995) so the press feels physical.
 * - Spotlight follows the pointer via the `--mx/--my` CSS vars in
 *   `.apple-card::before` (defined in globals.css).
 * - All motion uses the `ease-spring-critical` cubic — critically damped,
 *   no overshoot, settles in ~320ms.
 * - Respects prefers-reduced-motion: the spotlight + transforms are
 *   disabled globally; only the color/border change survives.
 */
interface AppleCardProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  /** Disable the spotlight sweep (use on dense grids). */
  noSpotlight?: boolean;
  /** Render a tighter padding (Apple-style for compact grids). */
  compact?: boolean;
  /** Apply the spring entrance animation. */
  springIn?: boolean | number;
  className?: string;
}

export default function AppleCard({
  children,
  noSpotlight = false,
  compact = false,
  springIn = false,
  className,
  onMouseMove,
  ...props
}: AppleCardProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!noSpotlight) {
        const el = ref.current;
        if (el) {
          const r = el.getBoundingClientRect();
          el.style.setProperty("--mx", `${e.clientX - r.left}px`);
          el.style.setProperty("--my", `${e.clientY - r.top}px`);
        }
      }
      onMouseMove?.(e);
    },
    [noSpotlight, onMouseMove]
  );

  const style: CSSProperties = {
    ...(props.style ?? {}),
  };

  const animationDelay = typeof springIn === "number" && springIn > 0 ? `${springIn}ms` : undefined;

  return (
    <div
      ref={ref}
      className={cn(
        "apple-card",
        compact ? "p-4" : "p-5 sm:p-6",
        typeof springIn !== "boolean" && animationDelay ? "spring-in" : null,
        springIn === true ? "spring-in" : null,
        className
      )}
      style={{ ...style, ...(animationDelay ? { animationDelay } : null) }}
      onMouseMove={handleMouseMove}
      {...props}
    >
      {children}
    </div>
  );
}
