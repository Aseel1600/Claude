// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notifications = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
};

vi.mock("@/store/notificationStore", () => ({
  useNotificationStore: () => notifications,
}));

const fetchMock = vi.fn();
const jsonResponse = (data: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  }) as Response;

const cleanupCallbacks: Array<() => void> = [];

function makeContainer(): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  cleanupCallbacks.push(() => container.remove());
  return container;
}

async function renderDistillation() {
  const { default: DistillationSettingsTab } = await import(
    "../../../components/layers/DistillationSettingsTab"
  );
  const container = makeContainer();
  const root = createRoot(container);
  await act(async () => {
    root.render(<DistillationSettingsTab />);
  });
  return { container, root };
}

const sampleEffective = {
  provider: "openai",
  model: "gpt-4o-mini",
  source: "global" as const,
  effective: { provider: "openai", model: "gpt-4o-mini" },
  canSetGlobal: true,
};

describe("DistillationSettingsTab", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    notifications.success.mockReset();
    notifications.error.mockReset();
    notifications.info.mockReset();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/memory/distillation-model") && init?.method === "PUT") {
        return jsonResponse({ ok: true });
      }
      if (u.endsWith("/api/memory/distillation-model") && (!init || init.method === "GET")) {
        return jsonResponse(sampleEffective);
      }
      if (u.startsWith("/api/memory/distillation-model") && init?.method === "DELETE") {
        return jsonResponse({ ok: true });
      }
      if (u.startsWith("/api/synced-available-models")) {
        return jsonResponse({
          models: [
            { id: "gpt-4o-mini", name: "GPT-4o mini" },
            { id: "gpt-4o", name: "GPT-4o" },
          ],
        });
      }
      if (u.endsWith("/api/memory/distillation-status")) {
        return jsonResponse({ running: true, lastError: null });
      }
      if (u.endsWith("/api/memory/distillation-dlq")) {
        return jsonResponse({ items: [] });
      }
      return jsonResponse({});
    });

    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    while (cleanupCallbacks.length > 0) cleanupCallbacks.pop()?.();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows the effective provider/model and the source layer badge", async () => {
    const { container } = await renderDistillation();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.textContent).toContain("openai");
    expect(container.textContent).toContain("gpt-4o-mini");
    const badge = container.querySelector("[data-testid='distillation-source-layer']");
    expect(badge).toBeTruthy();
    expect(badge?.getAttribute("data-source-layer")).toBe("global");
  });

  it("renders the override form with scope + provider + model dropdowns", async () => {
    const { container } = await renderDistillation();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.querySelector("[data-testid='distillation-scope']")).toBeTruthy();
    expect(container.querySelector("[data-testid='distillation-provider']")).toBeTruthy();
    expect(container.querySelector("[data-testid='distillation-model']")).toBeTruthy();
    expect(container.querySelector("[data-testid='distillation-apply']")).toBeTruthy();
    expect(container.querySelector("[data-testid='distillation-remove']")).toBeTruthy();
  });

  it("PUTs to /api/memory/distillation-model on apply", async () => {
    const { container } = await renderDistillation();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const apply = container.querySelector("[data-testid='distillation-apply']") as HTMLButtonElement;
    await act(async () => {
      apply.click();
    });
    const putCall = fetchMock.mock.calls.find(([url, init]) => {
      return (
        String(url).endsWith("/api/memory/distillation-model") &&
        (init as RequestInit | undefined)?.method === "PUT"
      );
    });
    expect(putCall).toBeTruthy();
    expect(notifications.success).toHaveBeenCalled();
  });

  it("DELETEs /api/memory/distillation-model?scope=… on remove", async () => {
    const { container } = await renderDistillation();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const remove = container.querySelector("[data-testid='distillation-remove']") as HTMLButtonElement;
    await act(async () => {
      remove.click();
    });
    const delCall = fetchMock.mock.calls.find(([url, init]) => {
      const u = String(url);
      return (
        u.includes("/api/memory/distillation-model") &&
        u.includes("scope=self") &&
        (init as RequestInit | undefined)?.method === "DELETE"
      );
    });
    expect(delCall).toBeTruthy();
  });

  it("renders a fallback hint when only a hint is available", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/memory/distillation-model") && (!init || init.method === "GET")) {
        return jsonResponse({
          provider: null,
          model: null,
          source: "env",
          effective: { provider: null, model: null },
          fallbackHint: { provider: "openai", model: "gpt-4o-mini" },
          canSetGlobal: false,
        });
      }
      if (u.startsWith("/api/synced-available-models")) return jsonResponse({ models: [] });
      if (u.endsWith("/api/memory/distillation-status")) return jsonResponse({ running: false });
      if (u.endsWith("/api/memory/distillation-dlq")) return jsonResponse({ items: [] });
      return jsonResponse({});
    });
    const { container } = await renderDistillation();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.querySelector("[data-testid='distillation-fallback']")).toBeTruthy();
  });

  it("shows the DLQ retry button when items are present", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/memory/distillation-model") && (!init || init.method === "GET")) {
        return jsonResponse(sampleEffective);
      }
      if (u.endsWith("/api/memory/distillation-status")) return jsonResponse({ running: false });
      if (u.endsWith("/api/memory/distillation-dlq")) {
        return jsonResponse({
          items: [{ id: "job-1", error: "rate_limit", createdAt: "2026-01-01T00:00:00Z" }],
        });
      }
      return jsonResponse({});
    });
    const { container } = await renderDistillation();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.querySelector("[data-testid='distillation-dlq-job-1']")).toBeTruthy();
    const retry = container.querySelector("[data-testid='distillation-dlq-retry-job-1']") as HTMLButtonElement;
    await act(async () => {
      retry.click();
    });
    const retryCall = fetchMock.mock.calls.find(([url, init]) => {
      return (
        String(url).includes("/api/memory/distillation-dlq/job-1/retry") &&
        (init as RequestInit | undefined)?.method === "PUT"
      );
    });
    expect(retryCall).toBeTruthy();
  });

  it("disables the global scope option when canSetGlobal is false", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/memory/distillation-model") && (!init || init.method === "GET")) {
        return jsonResponse({ ...sampleEffective, canSetGlobal: false });
      }
      if (u.endsWith("/api/memory/distillation-status")) return jsonResponse({ running: false });
      if (u.endsWith("/api/memory/distillation-dlq")) return jsonResponse({ items: [] });
      if (u.startsWith("/api/synced-available-models")) return jsonResponse({ models: [] });
      return jsonResponse({});
    });
    const { container } = await renderDistillation();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const select = container.querySelector("[data-testid='distillation-scope']") as HTMLSelectElement;
    const globalOpt = Array.from(select.querySelectorAll("option")).find((o) => o.value === "global");
    expect((globalOpt as HTMLOptionElement | undefined)?.disabled).toBe(true);
  });
});