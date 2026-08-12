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

async function renderL1(props: Parameters<typeof import("../../../components/layers/L1Tab").default>[0] = {}) {
  const { default: L1Tab } = await import("../../../components/layers/L1Tab");
  const container = makeContainer();
  const root = createRoot(container);
  await act(async () => {
    root.render(<L1Tab {...props} />);
  });
  return { container, root };
}

const sampleMemories = [
  {
    id: "mem-abc-123",
    type: "factual",
    priority: 80,
    content: "User prefers dark mode.",
    version: 1,
    lastModifiedBy: "system",
    edited: true,
    sceneId: "scene-xyz",
    score: 0.92,
  },
  {
    id: "mem-def-456",
    type: "episodic",
    priority: 60,
    content: "Had a long debugging session today.",
    version: 2,
    lastModifiedBy: "user",
    edited: false,
  },
];

describe("L1Tab", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    notifications.success.mockReset();
    notifications.error.mockReset();
    notifications.info.mockReset();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/memory/l1/memories")) {
        return jsonResponse({ data: sampleMemories });
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

  it("renders title + description", async () => {
    const { container } = await renderL1();
    expect(container.querySelector("[data-testid='l1-memories']")).toBeTruthy();
  });

  it("renders memory rows with type chips and edited marker", async () => {
    const { container } = await renderL1();
    await act(async () => {
      // wait for fetch to complete
      await new Promise((r) => setTimeout(r, 5));
    });
    const items = container.querySelectorAll("[data-testid^='l1-memory-']");
    expect(items.length).toBeGreaterThan(0);
    const edited = container.querySelector("[data-edited='true']");
    expect(edited).toBeTruthy();
    // Internal markers (is_internal, combo_execution_key) must NOT be in DOM
    expect(container.innerHTML).not.toMatch(/is_internal/);
    expect(container.innerHTML).not.toMatch(/combo_execution_key/);
  });

  it("renders empty state when no memories", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ data: [] }));
    const { container } = await renderL1();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(container.querySelector("[data-testid='l1-empty']")).toBeTruthy();
  });

  it("shows lineage chip when lineageFilter is provided", async () => {
    const { container } = await renderL1({ lineageFilter: ["mem-abc-123"] });
    expect(container.querySelector("[data-testid='l1-clear-lineage']")).toBeTruthy();
  });

  it("scopes the visible rows to the lineage filter", async () => {
    const { container } = await renderL1({ lineageFilter: ["mem-abc-123"] });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    const items = Array.from(container.querySelectorAll("[data-testid^='l1-memory-']"));
    expect(items.length).toBe(1);
    expect((items[0] as HTMLElement).getAttribute("data-testid")).toBe("l1-memory-mem-abc-123");
  });

  it("PUTs on edit save", async () => {
    const { container } = await renderL1();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    const editBtn = container.querySelector("[data-testid='l1-edit-mem-abc-123']") as HTMLButtonElement;
    await act(async () => {
      editBtn.click();
    });
    const saveBtn = container.querySelector("[data-testid='l1-save']") as HTMLButtonElement;
    await act(async () => {
      saveBtn.click();
    });
    const putCall = fetchMock.mock.calls.find(([url, init]) => {
      return (
        String(url).includes("/api/memory/l1/memories/mem-abc-123") &&
        (init as RequestInit | undefined)?.method === "PUT"
      );
    });
    expect(putCall).toBeTruthy();
    expect(notifications.success).toHaveBeenCalled();
  });

  it("DELETEs on soft delete confirm", async () => {
    const { container } = await renderL1();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    const softBtn = container.querySelector("[data-testid='l1-soft-delete-mem-abc-123']") as HTMLButtonElement;
    await act(async () => {
      softBtn.click();
    });
    const confirm = container.querySelector("[data-testid='l1-confirm-soft-delete']") as HTMLButtonElement;
    await act(async () => {
      confirm.click();
    });
    const delCall = fetchMock.mock.calls.find(([url, init]) => {
      return (
        String(url).includes("/api/memory/l1/memories/mem-abc-123") &&
        (init as RequestInit | undefined)?.method === "DELETE"
      );
    });
    expect(delCall).toBeTruthy();
  });

  it("POSTs /restore on restore click", async () => {
    const { container } = await renderL1();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    const restoreBtn = container.querySelector("[data-testid='l1-restore-mem-abc-123']") as HTMLButtonElement;
    await act(async () => {
      restoreBtn.click();
    });
    const restoreCall = fetchMock.mock.calls.find(([url, init]) => {
      return (
        String(url).includes("/api/memory/l1/memories/mem-abc-123/restore") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    expect(restoreCall).toBeTruthy();
  });

  it("shows score preview only when score is returned", async () => {
    const { container } = await renderL1();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(container.textContent).toMatch(/0\.920|0\.92/);
  });

  it("renders 7 localized type chips in the type select", async () => {
    const { container } = await renderL1();
    const select = container.querySelector("[data-testid='l1-type-filter']") as HTMLSelectElement;
    const opts = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(opts).toEqual(
      expect.arrayContaining([
        "all",
        "factual",
        "episodic",
        "procedural",
        "semantic",
        "user_profile",
        "preference",
        "constraint",
      ])
    );
  });

  it("renders a scene-link for memories with sceneId", async () => {
    const { container } = await renderL1();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(container.querySelector("[data-testid='l1-view-scene-mem-abc-123']")).toBeTruthy();
  });
});