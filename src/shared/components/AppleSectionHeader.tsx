import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/shared/utils/cn";

/**
 * AppleSectionHeader — editorial header with eyebrow + headline + subtitle.
 *
 * Apple design §16: "Build hierarchy from weight + size + leading as a
 * set, not size alone." The eyebrow uses a small caps + tracking bump
 * (Apple's "section label" pattern), the headline uses -0.018em
 * tracking at display sizes, and the subtitle clamps to ~60ch.
 */
interface AppleSectionHeaderProps extends HTMLAttributes<HTMLElement> {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  /** When true, centers the header horizontally. */
  centered?: boolean;
  className?: string;
}

export function AppleSectionHeader({
  eyebrow,
  title,
  subtitle,
  action,
  centered = false,
  className,
  ...props
}: AppleSectionHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-0",
        centered ? "items-center text-center" : "items-start text-left",
        className
      )}
      {...props}
    >
      <div
        className={cn(
          "flex w-full gap-4",
          centered
            ? "flex-col items-center"
            : "flex-col items-start sm:flex-row sm:items-end sm:justify-between"
        )}
      >
        <div className={cn("min-w-0", centered ? "max-w-2xl" : "")}>
          {eyebrow ? <div className="apple-section-eyebrow">{eyebrow}</div> : null}
          <h2 className="apple-section-title">{title}</h2>
          {subtitle ? <p className="apple-section-subtitle">{subtitle}</p> : null}
        </div>
        {action ? (
          <div className={cn("flex shrink-0 items-center gap-2", centered ? "" : "sm:pb-1")}>
            {action}
          </div>
        ) : null}
      </div>
    </header>
  );
}

/** Editorial display: large hero headline for top-of-page intros. */
interface AppleHeroProps extends HTMLAttributes<HTMLDivElement> {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function AppleHero({
  eyebrow,
  title,
  subtitle,
  action,
  className,
  ...props
}: AppleHeroProps) {
  return (
    <div className={cn("flex flex-col gap-5", className)} {...props}>
      {eyebrow ? <div className="apple-eyebrow">{eyebrow}</div> : null}
      <h1 className="apple-display text-[clamp(2.25rem,5vw,3.5rem)] max-w-3xl">{title}</h1>
      {subtitle ? (
        <p className="apple-body text-[15px] text-text-muted max-w-2xl">{subtitle}</p>
      ) : null}
      {action ? <div className="flex items-center gap-2 pt-1">{action}</div> : null}
    </div>
  );
}
