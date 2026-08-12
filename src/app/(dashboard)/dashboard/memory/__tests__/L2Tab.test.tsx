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

const sampleScenes = [
  {
    id: "scene-1",
    summary: "User prefers concise answers.",
    content: "Long content here.",
    heat: 0.7,
    times: 3,
    version: 2,
    modifier: "admin",
    status: "active",
    atomIds: ["mem-1", "mem-2"],
    personaId: "persona-1",
  },
];

async function renderL2() {
  const { default: L2Tab } = await import("../../../components/layers/L2Tab");
  const container = makeContainer();
  const root = createRoot(container);
  await act(async () => {
    root.render(<L2Tab />);
  });
  return { container, root };
}

describe("L2Tab", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    notifications.success.mockReset();
    notifications.error.mockReset();
    notifications.info.mockReset();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/memory/l2/scenes")) return jsonResponse({ data: sampleScenes });
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

  it("renders scene rows with heat/times/version/modifier", async () => {
    const { container } = await renderL2();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const row = container.querySelector("[data-testid='l2-scene-scene-1']") as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.getAttribute("data-status")).toBe("active");
    expect(container.textContent).toContain("0.70");
    expect(container.textContent).toContain("User prefers concise answers.");
  });

  it("renders atoms and persona links", async () => {
    const { container } = await renderL2();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.querySelector("[data-testid='l2-atoms-scene-1']")).toBeTruthy();
    expect(container.querySelector("[data-testid='l2-persona-scene-1']")).toBeTruthy();
  });

  it("POSTs /regenerate on regenerate click", async () => {
    const { container } = await renderL2();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const regen = container.querySelector("[data-testid='l2-regenerate-scene-1']") as HTMLButtonElement;
    await act(async () => {
      regen.click();
    });
    const regenCall = fetchMock.mock.calls.find(([url, init]) => {
      return (
        String(url).includes("/api/memory/l2/scenes/scene-1/regenerate") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    expect(regenCall).toBeTruthy();
  });

  it("DELETEs on delete confirm", async () => {
    const { container } = await renderL2();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const del = container.querySelector("[data-testid='l2-delete-scene-1']") as HTMLButtonElement;
    await act(async () => {
      del.click();
    });
    const confirm = container.querySelector("[data-testid='l2-confirm-delete']") as HTMLButtonElement;
    await act(async () => {
      confirm.click();
    });
    const delCall = fetchMock.mock.calls.find(([url, init]) => {
      return (
        String(url).includes("/api/memory/l2/scenes/scene-1") &&
        (init as RequestInit | undefined)?.method === "DELETE"
      );
    });
    expect(delCall).toBeTruthy();
  });
});