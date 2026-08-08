"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/shared/utils/cn";

/**
 * AppleButton — pill-shaped button with spring press and three weights.
 *
 * - press feedback is on `:active` (per Apple: "respond on pointer-down,
 *   not on release") and the cubic curve is critically damped so it
 *   reads as "weighted" rather than "snappy".
 * - Use `primary` sparingly; `secondary` and `tertiary` are the workhorses
 *   in a fluid interface.
 */
export type AppleButtonVariant = "primary" | "secondary" | "tertiary";
export type AppleButtonSize = "sm" | "md" | "lg";

interface AppleButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  variant?: AppleButtonVariant;
  size?: AppleButtonSize;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
  loading?: boolean;
  className?: string;
}

const sizeMap: Record<AppleButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-2.5 text-[15px]",
};

const variantClass: Record<AppleButtonVariant, string> = {
  primary: "apple-btn-primary",
  secondary: "apple-btn-secondary",
  tertiary: "apple-btn-tertiary",
};

const AppleButton = forwardRef<HTMLButtonElement, AppleButtonProps>(function AppleButton(
  {
    children,
    variant = "secondary",
    size = "md",
    icon,
    trailingIcon,
    loading,
    className,
    disabled,
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={props.type ?? "button"}
      disabled={disabled || loading}
      className={cn("apple-btn", variantClass[variant], sizeMap[size], className)}
      {...props}
    >
      {loading ? (
        <span
          className="material-symbols-outlined text-current opacity-70"
          style={{ fontSize: "1em" }}
          aria-hidden
        >
          progress_activity
        </span>
      ) : icon ? (
        <span className="inline-flex items-center" aria-hidden>
          {icon}
        </span>
      ) : null}
      {children && <span>{children}</span>}
      {trailingIcon ? (
        <span className="inline-flex items-center" aria-hidden>
          {trailingIcon}
        </span>
      ) : null}
    </button>
  );
});

export default AppleButton;
