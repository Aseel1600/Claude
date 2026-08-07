import { type HTMLAttributes } from "react";
import { cn } from "@/shared/utils/cn";

/**
 * AppleStatusDot — pulsing status indicator.
 *
 * - Spring-eased pulse (not the linear "loading" you get from most
 *   spinners) so it reads as "this thing is alive" rather than
 *   "still loading".
 * - Color via `currentColor` so a parent can tint the dot through
 *   `text-success`, `text-warning`, etc.
 * - `prefers-reduced-motion` disables the pulse globally (handled in
 *   globals.css).
 */
interface AppleStatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeMap = {
  sm: { w: 6, h: 6 },
  md: { w: 8, h: 8 },
  lg: { w: 10, h: 10 },
};

export default function AppleStatusDot({ size = "md", className, ...props }: AppleStatusDotProps) {
  const { w, h } = sizeMap[size];
  return (
    <span
      className={cn("apple-status-dot relative inline-block", className)}
      style={{ width: `${w}px`, height: `${h}px` }}
      aria-hidden
      {...props}
    />
  );
}
