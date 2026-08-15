// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ModalityBridgeVideoTab from "@/app/(dashboard)/dashboard/settings/components/modalityBridge/ModalityBridgeVideoTab";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const roots: Array<{ root: Root; element: HTMLDivElement }> = [];

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 2_000) throw new Error(`Timed out waiting for ${label}`);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}

describe("ModalityBridgeVideoTab", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/modality-bridge/video/runtime")) {
        return Response.json({
          available: true,
          ffmpegVersion: "6.1.1",
          ffprobeVersion: "6.1.1",
        });
      }
      if (url.includes("/api/modality-bridge/stats")) {
        return Response.json({
          video: { bridged: 3, cacheHits: 1, failures: 0, lastUsedAt: null },
        });
      }
      if (url.includes("/api/models")) {
        return Response.json({
          models: [
            { provider: "openai", model: "gpt-4o-mini", supportsVision: true },
            { provider: "example", model: "text-only", supportsVision: false },
          ],
        });
      }
      if (url.includes("/api/settings")) {
        if (init?.method === "PATCH") return Response.json({});
        return Response.json({
          modalityBridgeVideoEnabled: false,
          modalityBridgeVideoModel: "openai/gpt-4o-mini",
          modalityBridgeVideoFrameCount: 8,
          modalityBridgeVideoMaxVideos: 1,
          modalityBridgeVideoTimeout: 120_000,
        });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    for (const { root, element } of roots.splice(0)) {
      act(() => root.unmount());
      element.remove();
    }
    vi.unstubAllGlobals();
  });

  async function render(): Promise<HTMLDivElement> {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const root = createRoot(element);
    await act(async () => root.render(<ModalityBridgeVideoTab />));
    roots.push({ root, element });
    await waitFor(
      () => element.querySelector('[data-testid="modality-bridge-video-frame-count"]') !== null,
      "Video Bridge settings"
    );
    return element;
  }

  it("shows ready runtime versions, video stats, and only vision-capable models", async () => {
    const element = await render();
    await waitFor(() => element.textContent?.includes("6.1.1") ?? false, "runtime status");
    await waitFor(
      () => Array.from(element.querySelectorAll("option")).some((option) => option.value),
      "model options"
    );
    const options = Array.from(element.querySelectorAll("option")).map((option) => option.value);
    expect(options).toContain("openai/gpt-4o-mini");
    expect(options).not.toContain("example/text-only");
    expect(element.textContent).toContain("3 modalityBridgeStatsBridged");
    expect(element.textContent).not.toContain("modalityBridgeVideoComingSoon");
  });

  it("persists the enable toggle and clamps frame count to 16", async () => {
    const element = await render();
    const toggle = element.querySelector('[role="switch"]') as HTMLButtonElement;
    await act(async () => toggle.click());
    const frameCount = element.querySelector(
      '[data-testid="modality-bridge-video-frame-count"]'
    ) as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      setter?.call(frameCount, "99");
      frameCount.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      frameCount.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(
      () =>
        fetchMock.mock.calls.some(([, init]) => {
          if (init?.method !== "PATCH") return false;
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          return body.modalityBridgeVideoFrameCount === 16;
        }),
      "clamped frame count PATCH"
    );
    const patches = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "PATCH")
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
    expect(patches).toContainEqual({ modalityBridgeVideoEnabled: true });
  });
});
