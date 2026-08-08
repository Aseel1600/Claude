import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/shared/utils/cn";

/**
 * AppleSurface — translucent material with three weights.
 *
 * Apple design §12: "Material weight encodes hierarchy — darker/heavier
 * materials separate structural regions (sidebars); lighter materials
 * draw attention to interactive elements. Never stack a light glass
 * on another — legibility collapses."
 *
 * - `light` (glass-1) — buttons, chips, tooltips
 * - `medium` (glass-2) — toolbars, dropdowns, sheets
 * - `heavy` (glass-3) — modals, command palette, popovers
 */
export type AppleSurfaceWeight = "light" | "medium" | "heavy";

interface AppleSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  weight?: AppleSurfaceWeight;
  children?: ReactNode;
  className?: string;
}

const weightClass: Record<AppleSurfaceWeight, string> = {
  light: "glass-1",
  medium: "glass-2",
  heavy: "glass-3",
};

export function AppleSurface({
  weight = "medium",
  children,
  className,
  ...props
}: AppleSurfaceProps) {
  return (
    <div className={cn(weightClass[weight], className)} {...props}>
      {children}
    </div>
  );
}

/**
 * AppleEmptyState — composed "nothing here yet" with a clear next step.
 *
 * Apple design §16: "An empty dashboard showing nothing is a missed
 * opportunity. Design a composed 'getting started' view." Replaces the
 * generic "No data" / sad empty placeholders with an action shape.
 */
interface AppleEmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function AppleEmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: AppleEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-14 px-6",
        "rounded-card border border-dashed border-border bg-bg-subtle/40",
        "spring-in",
        className
      )}
      {...props}
    >
      {icon ? (
        <div className="size-14 rounded-2xl glass-1 flex items-center justify-center text-text-muted mb-4">
          {icon}
        </div>
      ) : null}
      <h3 className="apple-headline text-[18px] text-text-main">{title}</h3>
      {description ? (
        <p className="apple-body text-sm text-text-muted mt-2 max-w-md">{description}</p>
      ) : null}
      {action ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>
      ) : null}
    </div>
  );
}
