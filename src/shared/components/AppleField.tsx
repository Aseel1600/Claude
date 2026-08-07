"use client";

import {
  Children,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/shared/utils/cn";

/**
 * AppleField — label + control + hint + error wrapper.
 *
 * Apple design §15: "Build hierarchy from weight + size + leading as a
 * set." The label is small-medium weight with a 4px gap to the control
 * (not the 6px+ Material default). Hints use 12px / muted; errors use
 * 12px / red-500 with an icon for screen-reader users.
 *
 * Pair with AppleInput, AppleTextarea, or AppleSelect (all in this
 * file) so the field visuals stay consistent across the form.
 */
interface AppleFieldProps {
  id?: string;
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Optional inline prefix (e.g. "1. ", a number badge) shown next to the label. */
  prefix?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function AppleField({
  id,
  label,
  hint,
  error,
  required,
  prefix,
  children,
  className,
}: AppleFieldProps) {
  const hintId = hint && !error ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <label
          htmlFor={id}
          className="text-[12px] font-medium text-text-main tracking-[-0.005em] flex items-center gap-1.5"
        >
          {prefix ? (
            <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-text-muted">
              {prefix}
            </span>
          ) : null}
          <span>{label}</span>
          {required ? (
            <span className="text-red-500 ml-0.5" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p id={errorId} className="text-[11px] text-red-500 flex items-center gap-1" role="alert">
          <span className="material-symbols-outlined text-[12px]" aria-hidden="true">
            error
          </span>
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-[11px] text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// ─── Shared control chrome ──────────────────────────────────────────────
// Both AppleInput, AppleTextarea, and AppleSelect use the same outer
// ring + focus styles so the field set looks visually consistent.
//
// Border uses an explicit `border-black/10 dark:border-white/15` instead
// of `border-border` because `--color-border` is `rgba(0,0,0,0.08)` —
// against `bg-surface` the 8% line is almost invisible. The slightly
// stronger 10% keeps the control visually defined without losing the
// "soft" Apple feel.
const CONTROL_BASE =
  "w-full text-sm text-text-main placeholder:text-text-muted/70 " +
  "bg-bg-subtle/60 border border-black/10 dark:border-white/15 rounded-control " +
  "transition-[box-shadow,border-color,background-color] " +
  "duration-200 [transition-timing-function:var(--ease-spring-critical)] " +
  "hover:border-black/15 dark:hover:border-white/25 " +
  "focus:outline-none focus:border-primary/50 focus:bg-surface " +
  "focus:shadow-[0_0_0_3px_rgba(127,29,29,0.12)] " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

// ─── AppleInput ─────────────────────────────────────────────────────────
interface AppleInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const AppleInput = forwardRef<HTMLInputElement, AppleInputProps>(function AppleInput(
  { invalid, className, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn(
        CONTROL_BASE,
        "py-2 px-3",
        invalid &&
          "border-red-500/60 focus:border-red-500 focus:shadow-[0_0_0_3px_rgba(239,68,68,0.18)]",
        className
      )}
      {...props}
    />
  );
});

// ─── AppleTextarea ──────────────────────────────────────────────────────
interface AppleTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const AppleTextarea = forwardRef<HTMLTextAreaElement, AppleTextareaProps>(
  function AppleTextarea({ invalid, className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          CONTROL_BASE,
          "py-2 px-3 leading-relaxed resize-y min-h-[64px]",
          invalid &&
            "border-red-500/60 focus:border-red-500 focus:shadow-[0_0_0_3px_rgba(239,68,68,0.18)]",
          className
        )}
        {...props}
      />
    );
  }
);

// ─── AppleSelect ────────────────────────────────────────────────────────
// Custom Apple-style dropdown.
//
// The native <select> element is convenient, but its open menu is rendered
// by the operating system: a gray panel with the OS blue selection
// highlight and the platform's default font stack. Against the rest of
// the field set (rounded controls, primary focus ring, burgundy
// selection) it looks completely out of place. This implementation
// replaces the open state with a styled popover that matches the rest
// of the field chrome, while keeping the same children-as-<option> API
// so call sites don't need to change.
//
// Accessibility:
//   • role="combobox" on the trigger, aria-haspopup="listbox"
//   • role="listbox" on the menu, role="option" on items
//   • ArrowUp/Down/Home/End navigate, Enter/Space selects, Escape closes,
//     Tab commits the focused value and dismisses
//   • The trigger keeps a hidden <input name> so native form submission
//     still works.
interface ParsedOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  group?: string;
}

function parseSelectChildren(children: ReactNode): ParsedOption[] {
  const options: ParsedOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const type = child.type as unknown;
    if (type === "option") {
      const props = child.props as { value?: unknown; children?: ReactNode; disabled?: boolean };
      options.push({
        value: String(props.value ?? ""),
        label: props.children,
        disabled: !!props.disabled,
      });
    } else if (type === "optgroup") {
      const props = child.props as { label?: ReactNode; children?: ReactNode };
      const groupLabel = typeof props.label === "string" ? props.label : undefined;
      Children.forEach(props.children, (gc) => {
        if (!isValidElement(gc)) return;
        const gType = gc.type as unknown;
        if (gType !== "option") return;
        const gProps = gc.props as { value?: unknown; children?: ReactNode; disabled?: boolean };
        options.push({
          value: String(gProps.value ?? ""),
          label: gProps.children,
          disabled: !!gProps.disabled,
          group: groupLabel,
        });
      });
    }
  });
  return options;
}

interface AppleSelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "onChange" | "value" | "children" | "size"
> {
  invalid?: boolean;
  onChange?: (event: { target: { value: string; name?: string } }) => void;
  value?: string;
  /** Text shown when the value is empty and no placeholder <option> exists. */
  placeholder?: string;
  children: ReactNode;
}

export const AppleSelect = forwardRef<HTMLButtonElement, AppleSelectProps>(function AppleSelect(
  {
    invalid,
    className,
    children,
    value,
    onChange,
    disabled,
    name,
    id,
    required,
    placeholder,
    onBlur,
    ...rest
  },
  ref
) {
  const options = useMemo(() => parseSelectChildren(children), [children]);
  const stringValue = value ?? "";
  const matched = options.find((o) => o.value === stringValue);
  const fallbackPlaceholder =
    placeholder ??
    (typeof options[0]?.label === "string" && options[0]?.value === ""
      ? options[0].label
      : "Select…");
  const isPlaceholder = !matched;
  const displayLabel = matched ? matched.label : fallbackPlaceholder;

  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const reactId = useId();
  const listboxId = `${reactId}-listbox`;

  // Keep the forwarded ref + internal ref in sync.
  const setTriggerRef = useCallback(
    (node: HTMLButtonElement | null) => {
      triggerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as MutableRefObject<HTMLButtonElement | null>).current = node;
    },
    [ref]
  );

  const openMenu = useCallback(() => {
    // Land on the currently-selected option, else the first enabled one.
    const idx = options.findIndex((o) => o.value === stringValue);
    if (idx >= 0) setFocusedIndex(idx);
    else {
      const firstEnabled = options.findIndex((o) => !o.disabled);
      setFocusedIndex(firstEnabled >= 0 ? firstEnabled : 0);
    }
    setIsOpen(true);
  }, [options, stringValue]);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setFocusedIndex(-1);
  }, []);

  // Close on outside click / outside pointerdown.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [isOpen, closeMenu]);

  // Scroll the focused option into view as the user navigates.
  useEffect(() => {
    if (!isOpen || focusedIndex < 0 || !listRef.current) return;
    const item = listRef.current.querySelector<HTMLLIElement>(
      `[data-option-index="${focusedIndex}"]`
    );
    item?.scrollIntoView({ block: "nearest" });
  }, [focusedIndex, isOpen]);

  const selectOption = useCallback(
    (option: ParsedOption) => {
      if (option.disabled) return;
      onChange?.({ target: { value: option.value, name } });
      closeMenu();
      // Return focus to the trigger so keyboard users land somewhere sensible.
      triggerRef.current?.focus();
    },
    [onChange, name, closeMenu]
  );

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
      case "Enter":
      case " ":
        event.preventDefault();
        openMenu();
        break;
      case "Escape":
        if (isOpen) {
          event.preventDefault();
          closeMenu();
        }
        break;
    }
  };

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (options.length === 0) return;
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        setFocusedIndex((i) => {
          for (let step = 1; step <= options.length; step++) {
            const next = (i + step) % options.length;
            if (!options[next].disabled) return next;
          }
          return i;
        });
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        setFocusedIndex((i) => {
          for (let step = 1; step <= options.length; step++) {
            const next = (i - step + options.length) % options.length;
            if (!options[next].disabled) return next;
          }
          return i;
        });
        break;
      }
      case "Home":
        event.preventDefault();
        setFocusedIndex(options.findIndex((o) => !o.disabled));
        break;
      case "End": {
        event.preventDefault();
        let last = -1;
        for (let i = options.length - 1; i >= 0; i--) {
          if (!options[i].disabled) {
            last = i;
            break;
          }
        }
        setFocusedIndex(last);
        break;
      }
      case "Enter":
      case " ": {
        event.preventDefault();
        const opt = options[focusedIndex];
        if (opt) selectOption(opt);
        break;
      }
      case "Escape":
        event.preventDefault();
        closeMenu();
        triggerRef.current?.focus();
        break;
      case "Tab":
        // Let the tab move on, but commit the highlighted option as the
        // value so the form doesn't lose the user's intent.
        if (focusedIndex >= 0) {
          const opt = options[focusedIndex];
          if (opt && !opt.disabled) {
            onChange?.({ target: { value: opt.value, name } });
          }
        }
        closeMenu();
        break;
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Native form submission compatibility: a hidden input mirrors the
            current value so <form> / FormData picks it up the same way a
            real <select name> would. */}
      {name ? <input type="hidden" name={name} value={stringValue} /> : null}

      <button
        ref={setTriggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          if (isOpen) closeMenu();
          else openMenu();
        }}
        onKeyDown={onTriggerKeyDown}
        onBlur={(event) => {
          // Defer: if focus is moving into the listbox, don't fire onBlur yet.
          if (containerRef.current?.contains(event.relatedTarget as Node | null)) return;
          onBlur?.(event as unknown as React.FocusEvent<HTMLSelectElement>);
        }}
        className={cn(
          CONTROL_BASE,
          "py-2 ps-3 pe-9 text-start cursor-pointer truncate",
          isPlaceholder && "text-text-muted",
          invalid &&
            "border-red-500/60 focus:border-red-500 focus:shadow-[0_0_0_3px_rgba(239,68,68,0.18)]",
          className
        )}
        {...rest}
      >
        <span className="block truncate">{displayLabel}</span>
      </button>

      <div
        className={cn(
          "pointer-events-none absolute inset-y-0 end-0 flex items-center pe-3 text-text-muted",
          "transition-transform duration-200 [transition-timing-function:var(--ease-spring-critical)]",
          isOpen && "rotate-180 text-primary"
        )}
        aria-hidden="true"
      >
        <span className="material-symbols-outlined text-[18px]">expand_more</span>
      </div>

      {isOpen ? (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          autoFocus
          onKeyDown={onListKeyDown}
          className={cn(
            "absolute z-50 mt-1.5 w-full max-h-64 overflow-auto p-1 outline-none",
            "rounded-card border border-black/10 dark:border-white/15",
            "glass-1 shadow-[0_12px_32px_-4px_rgba(20,20,40,0.18),0_2px_6px_rgba(20,20,40,0.06)]",
            "origin-top",
            "animate-[apple-spring-in_var(--dur-normal)_var(--ease-spring-soft)_both]"
          )}
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-text-muted">No options</li>
          ) : (
            options.map((option, index) => {
              const isSelected = option.value === stringValue;
              const isFocused = index === focusedIndex;
              const showGroupLabel =
                option.group && (index === 0 || options[index - 1]?.group !== option.group);
              return (
                <li key={`${option.value}-${index}`}>
                  {showGroupLabel ? (
                    <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-text-muted">
                      {option.group}
                    </div>
                  ) : null}
                  <div
                    data-option-index={index}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    onMouseEnter={() => setFocusedIndex(index)}
                    onMouseDown={(event) => event.preventDefault() /* keep focus on trigger */}
                    onClick={() => selectOption(option)}
                    className={cn(
                      "relative flex items-center gap-2 rounded-control ps-3 pe-2 py-2 text-sm cursor-pointer",
                      "transition-colors duration-150 [transition-timing-function:var(--ease-spring-critical)]",
                      option.disabled && "opacity-50 cursor-not-allowed",
                      !option.disabled && isFocused && !isSelected && "bg-black/5 dark:bg-white/8",
                      isSelected && "bg-primary/10 text-primary font-medium"
                    )}
                  >
                    <span className="flex-1 truncate">{option.label}</span>
                    {isSelected ? (
                      <span
                        className="material-symbols-outlined text-[16px] text-primary"
                        aria-hidden="true"
                      >
                        check
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
});
