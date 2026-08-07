import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/shared/utils/cn";

/**
 * AppleMetric — large numeric readout with Apple's typographic discipline.
 *
 * - tabular-nums so columns of metrics don't reflow as values change
 * - negative tracking at large sizes (per apple-design skill §15)
 * - pairs with `AppleMetricLabel` for the eyebrow-style caption
 *
 * Example:
 *   <AppleMetric size="lg">47.2%</AppleMetric>
 *   <AppleMetricLabel>success rate</AppleMetricLabel>
 */
interface AppleMetricProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  trend?: "up" | "down" | "flat";
  className?: string;
}

const sizeClass: Record<NonNullable<AppleMetricProps["size"]>, string> = {
  sm: "text-lg",
  md: "text-2xl",
  lg: "text-[clamp(1.75rem,2.5vw,2.25rem)]",
  xl: "text-[clamp(2.5rem,4.5vw,3.5rem)]",
};

export default function AppleMetric({
  children,
  size = "md",
  trend,
  className,
  ...props
}: AppleMetricProps) {
  return (
    <div
      className={cn(
        "apple-metric inline-flex items-baseline gap-1.5",
        sizeClass[size],
        trend === "up" && "text-success",
        trend === "down" && "text-error",
        trend === "flat" && "text-text-muted",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface AppleMetricLabelProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  className?: string;
}

export function AppleMetricLabel({ children, className, ...props }: AppleMetricLabelProps) {
  return (
    <div className={cn("apple-metric-label", className)} {...props}>
      {children}
    </div>
  );
}

interface AppleMetricSubProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  className?: string;
}

export function AppleMetricSub({ children, className, ...props }: AppleMetricSubProps) {
  return (
    <div className={cn("text-xs text-text-muted mt-1 font-medium", className)} {...props}>
      {children}
    </div>
  );
}
