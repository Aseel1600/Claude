// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const translate = (key: string) => key;
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => Object.assign(translate, { has: () => false }),
}));

const { default: ProfilePage } = await import("@/app/(dashboard)/dashboard/profile/page");

const roots: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = [];

function mountProfile() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container });
  act(() => root.render(<ProfilePage />));
  return container;
}

async function waitForLoad(container: HTMLDivElement) {
  for (let i = 0; i < 40 && container.querySelector('[role="status"]'); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

afterEach(() => {
  for (const { root, container } of roots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Profile accessibility semantics", () => {
  it("announces the loading state as a busy polite status", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined))
    );

    const container = mountProfile();
    const status = container.querySelector('[role="status"]');

    expect(status?.textContent).toContain("profileLoading");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.getAttribute("aria-busy")).toBe("true");
  });

  it("exposes the page heading and XP progress value", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/level")) {
          return { ok: true, json: async () => ({ level: { totalXp: 150, currentLevel: 2 } }) };
        }
        return { ok: true, json: async () => ({ badges: [] }) };
      })
    );

    const container = mountProfile();
    await waitForLoad(container);

    expect(container.querySelector("h1")?.textContent).toBe("profile");
    const progress = container.querySelector('[role="progressbar"]');
    expect(progress?.getAttribute("aria-valuemin")).toBe("0");
    const max = Number(progress?.getAttribute("aria-valuemax"));
    const now = Number(progress?.getAttribute("aria-valuenow"));
    expect(max).toBeGreaterThan(0);
    expect(now).toBeGreaterThanOrEqual(0);
    expect(now).toBeLessThanOrEqual(max);
  });

  it("announces a complete load failure as an alert", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false }))
    );

    const container = mountProfile();
    await waitForLoad(container);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("profileLoadFailed");
  });
});
