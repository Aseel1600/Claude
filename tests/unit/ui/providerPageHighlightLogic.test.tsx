// @vitest-environment jsdom
/**
 * Tests for the page-level highlighted-card matching/clearing logic
 * extracted into providerPageUrlState.ts.
 *
 * These import the real production functions — not copied code.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderCardHandle } from "@/app/(dashboard)/dashboard/providers/components/ProviderCard";
import {
  recordProviderNavigation,
  resolveHighlightedCard,
  syncSearchToUrl,
} from "@/app/(dashboard)/dashboard/providers/providerPageUrlState";

function createMockHandle(
  id: string,
  callbacks?: { onScroll?(): void; onHighlight?(): void }
): ProviderCardHandle {
  return {
    getProviderId() {
      return id;
    },
    scrollIntoView() {
      callbacks?.onScroll?.();
    },
    highlight() {
      callbacks?.onHighlight?.();
    },
  };
}

describe("resolveHighlightedCard", () => {
  it("calls scrollIntoView + highlight when handle matches highlighted id", () => {
    const onScroll = vi.fn();
    const onHighlight = vi.fn();
    const onAfterHighlight = vi.fn();
    const handle = createMockHandle("openai", { onScroll, onHighlight });

    resolveHighlightedCard(handle, "openai", onAfterHighlight);

    expect(onScroll).toHaveBeenCalledTimes(1);
    expect(onHighlight).toHaveBeenCalledTimes(1);
    expect(onAfterHighlight).toHaveBeenCalledTimes(1);
  });

  it("does NOT call scrollIntoView or highlight when ids do not match", () => {
    const onScroll = vi.fn();
    const onHighlight = vi.fn();
    const onAfterHighlight = vi.fn();
    const handle = createMockHandle("openai", { onScroll, onHighlight });

    resolveHighlightedCard(handle, "anthropic", onAfterHighlight);

    expect(onScroll).not.toHaveBeenCalled();
    expect(onHighlight).not.toHaveBeenCalled();
    expect(onAfterHighlight).toHaveBeenCalledTimes(1);
  });

  it("calls onAfterHighlight even when handle is null", () => {
    const onAfterHighlight = vi.fn();
    resolveHighlightedCard(null, "openai", onAfterHighlight);
    expect(onAfterHighlight).toHaveBeenCalledTimes(1);
  });

  it("calls onAfterHighlight even when ids do not match", () => {
    const onAfterHighlight = vi.fn();
    const handle = createMockHandle("kimi-coding");
    resolveHighlightedCard(handle, "openai", onAfterHighlight);
    expect(onAfterHighlight).toHaveBeenCalledTimes(1);
  });

  it("only the matching handle triggers scroll + highlight among multiple", () => {
    const calls: string[] = [];
    const onAfterHighlight = vi.fn();
    const handles = [
      createMockHandle("openai", {
        onScroll: () => calls.push("openai-scroll"),
        onHighlight: () => calls.push("openai-highlight"),
      }),
      createMockHandle("anthropic", {
        onScroll: () => calls.push("anthropic-scroll"),
        onHighlight: () => calls.push("anthropic-highlight"),
      }),
      createMockHandle("cursor", {
        onScroll: () => calls.push("cursor-scroll"),
        onHighlight: () => calls.push("cursor-highlight"),
      }),
    ];

    resolveHighlightedCard(handles[0], "cursor", onAfterHighlight);
    resolveHighlightedCard(handles[1], "cursor", onAfterHighlight);
    resolveHighlightedCard(handles[2], "cursor", onAfterHighlight);

    expect(calls).toEqual(["cursor-scroll", "cursor-highlight"]);
    expect(onAfterHighlight).toHaveBeenCalledTimes(3);
  });
});

describe("recordProviderNavigation", () => {
  const originalReplaceState = window.history.replaceState;

  afterEach(() => {
    window.history.replaceState = originalReplaceState;
  });

  it("calls history.replaceState with the provider id", () => {
    const replaceSpy = vi.fn();
    window.history.replaceState = replaceSpy;

    recordProviderNavigation("openai");

    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith({ providerId: "openai" }, "");
  });

  it("sets different provider ids on successive calls", () => {
    const replaceSpy = vi.fn();
    window.history.replaceState = replaceSpy;

    recordProviderNavigation("openai");
    recordProviderNavigation("anthropic");
    recordProviderNavigation("kimi-coding");

    expect(replaceSpy).toHaveBeenCalledTimes(3);
    expect(replaceSpy.mock.calls[0][0]).toEqual({ providerId: "openai" });
    expect(replaceSpy.mock.calls[1][0]).toEqual({ providerId: "anthropic" });
    expect(replaceSpy.mock.calls[2][0]).toEqual({ providerId: "kimi-coding" });
  });
});

describe("syncSearchToUrl", () => {
  const originalReplaceState = window.history.replaceState;
  const originalLocation = window.location;

  afterEach(() => {
    window.history.replaceState = originalReplaceState;
    Object.defineProperty(window, "location", { value: originalLocation, writable: true });
  });

  it("sets search param in URL when query is non-empty", () => {
    const replaceSpy = vi.fn();
    window.history.replaceState = replaceSpy;
    Object.defineProperty(window, "location", {
      value: { href: "http://localhost:3000/dashboard/providers" },
      writable: true,
    });

    syncSearchToUrl("openai");

    expect(replaceSpy).toHaveBeenCalledTimes(1);
    const [, , url] = replaceSpy.mock.calls[0];
    expect(url).toContain("search=openai");
  });

  it("removes search param when query is empty", () => {
    const replaceSpy = vi.fn();
    window.history.replaceState = replaceSpy;
    Object.defineProperty(window, "location", {
      value: { href: "http://localhost:3000/dashboard/providers?search=openai" },
      writable: true,
    });

    syncSearchToUrl("");

    expect(replaceSpy).toHaveBeenCalledTimes(1);
    const [, , url] = replaceSpy.mock.calls[0];
    expect(url).not.toContain("search=");
  });

  it("preserves existing search params when updating", () => {
    const replaceSpy = vi.fn();
    window.history.replaceState = replaceSpy;
    Object.defineProperty(window, "location", {
      value: { href: "http://localhost:3000/dashboard/providers?tab=oauth" },
      writable: true,
    });

    syncSearchToUrl("anthropic");

    expect(replaceSpy).toHaveBeenCalledTimes(1);
    const [, , url] = replaceSpy.mock.calls[0];
    expect(url).toContain("search=anthropic");
    expect(url).toContain("tab=oauth");
  });

  it("preserves current history state", () => {
    const replaceSpy = vi.fn();
    window.history.replaceState = replaceSpy;
    Object.defineProperty(window, "location", {
      value: { href: "http://localhost:3000/dashboard/providers" },
      writable: true,
    });
    const existingState = { providerId: "openai" };
    window.history.replaceState(existingState, "");

    syncSearchToUrl("anthropic");

    const [state] = replaceSpy.mock.calls[0];
    expect(state).toBe(existingState);
  });
});
