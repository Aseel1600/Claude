import { type HTMLAttributes } from "react";
import { cn } from "@/shared/utils/cn";

/**
 * AppleStatusDot — color-coded status indicator.
 *
 * Two modes:
 * - `pulse` (default) — adds the spring-eased pulse + expanding shadow,
 *   reads as "this thing is alive" rather than "still loading". Use for
 *   online/live/heartbeat indicators.
 * - `pulse={false}` — static dot, no animation. Use for state pills
 *   (e.g. "no connections", "disabled") where a constant pulse would be
 *   distracting and the dot's outer shadow would get clipped by parents
 *   that use `overflow-hidden` to keep the row tight.
 *
 * Color via `currentColor` so a parent can tint the dot through
 * `text-success`, `text-warning`, etc.
 * `prefers-reduced-motion` disables the pulse globally (handled in
 * globals.css).
 */
interface AppleStatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  size?: "sm" | "md" | "lg";
  /**
   * Animate the dot with the apple-pulse keyframes. Default true.
   * Set false for static state indicators (e.g. "no connections",
   * "disabled") where a constant pulse is distracting or gets clipped
   * by `overflow-hidden` parents.
   */
  pulse?: boolean;
  className?: string;
}

const sizeMap = {
  sm: { w: 6, h: 6 },
  md: { w: 8, h: 8 },
  lg: { w: 10, h: 10 },
};

export default function AppleStatusDot({
  size = "md",
  pulse = true,
  className,
  ...props
}: AppleStatusDotProps) {
  const { w, h } = sizeMap[size];
  return (
    <span
      className={cn(
        // shrink-0 keeps the dot from being squeezed below its size by flex
        // parents that use `min-w-0 overflow-hidden` to keep their row tight
        // (e.g. ProviderCard footer with `flex-nowrap`). Without this, the
        // 6px dot can collapse to 0 and look "clipped" in narrow viewports.
        "apple-status-dot relative inline-block shrink-0",
        pulse ? "apple-status-dot--pulse" : null,
        className
      )}
      style={{ width: `${w}px`, height: `${h}px` }}
      aria-hidden
      {...props}
    />
  );
}
