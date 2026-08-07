"use client";

import { useLayoutEffect, useRef } from "react";
import { cn } from "@/shared/utils/cn";

interface SegmentedOption {
  value: string;
  label: string;
  icon?: string;
}

interface SegmentedControlProps {
  options?: SegmentedOption[];
  value?: string;
  onChange?: (value: string) => void;
  size?: "sm" | "md" | "lg";
  className?: string;
  "aria-label"?: string;
}

/**
 * Apple-style segmented control.
 *
 * Track: glass-1 (semi-transparent + blur) with a fully rounded pill.
 * Active tab: a single absolutely-positioned indicator pill that
 * slides between tabs using `transform: translateX(...)` + `width`,
 * with a spring overshoot easing. Each tab button sits above the
 * indicator and is itself transparent — the indicator shows through.
 *
 * No framer-motion dependency; the spring is pure CSS. The indicator
 * position is written imperatively in `useLayoutEffect` (no setState
 * in effect, no extra render).
 */
export default function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  className,
  "aria-label": ariaLabel,
}: SegmentedControlProps) {
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const indicatorRef = useRef<HTMLSpanElement>(null);

  // Position the indicator under the active tab. useLayoutEffect fires
  // before paint, so the indicator is in the correct position from
  // frame 1 — no flicker from a (0,0) starting state.
  useLayoutEffect(() => {
    const active = value ? tabRefs.current[value] : null;
    const el = indicatorRef.current;
    if (!el) return;
    if (!active) {
      el.style.opacity = "0";
      return;
    }
    el.style.transform = `translateX(${active.offsetLeft}px)`;
    el.style.width = `${active.offsetWidth}px`;
    el.style.opacity = "1";
  }, [value, options.length]);

  const sizes = {
    sm: "h-7 text-[12px]",
    md: "h-9 text-[13px]",
    lg: "h-11 text-[15px]",
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "apple-segmented",
        "glass-1 inline-flex items-center p-[3px] rounded-full",
        className
      )}
    >
      <span
        ref={indicatorRef}
        aria-hidden
        className="apple-segmented-indicator"
        style={{ opacity: 0 }}
      />
      {options.map((option) => (
        <button
          key={option.value}
          ref={(el) => {
            tabRefs.current[option.value] = el;
          }}
          role="tab"
          aria-selected={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChange?.(option.value)}
          className={cn(
            "apple-segmented-tab",
            "relative z-[1] inline-flex items-center justify-center gap-1.5 px-3.5 rounded-full font-medium whitespace-nowrap",
            sizes[size],
            value === option.value ? "text-text-main" : "text-text-muted hover:text-text-main/80"
          )}
        >
          {option.icon ? (
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
              {option.icon}
            </span>
          ) : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}
