// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FirstRunReadinessCard from "@/app/(dashboard)/dashboard/FirstRunReadinessCard";
import CommandPalette from "@/shared/components/CommandPalette";

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const translate = (key: string) => key;
    translate.has = () => true;
    return translate;
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const DISMISS_STORAGE_KEY = "omniroute-first-run-readiness-dismissed";

if (typeof Element.prototype.scrollIntoView === "undefined") {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: () => {},
  });
}

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

describe("first-run readiness and command palette hook state", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}))
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("synchronizes first-run dismissal written by another browser context", async () => {
    await act(async () => {
      root.render(<FirstRunReadinessCard setupComplete={false} />);
    });
    expect(container.querySelector('[role="region"]')).not.toBeNull();

    localStorage.setItem(DISMISS_STORAGE_KEY, "true");
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: DISMISS_STORAGE_KEY,
          newValue: "true",
          storageArea: localStorage,
        })
      );
    });

    expect(container.querySelector('[role="region"]')).toBeNull();
  });

  it("keeps hidden essentials tools searchable after settings load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          hiddenSidebarItems: ["playground"],
          sidebarActivePreset: "essentials",
        })
      )
    );

    await act(async () => {
      root.render(<CommandPalette isOpen onClose={vi.fn()} />);
    });

    const labels = Array.from(container.querySelectorAll('[role="option"] p')).map(
      (label) => label.textContent
    );
    expect(labels).toContain("playground");
  });
});
