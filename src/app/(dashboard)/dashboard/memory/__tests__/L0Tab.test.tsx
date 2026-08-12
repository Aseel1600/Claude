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

const sampleMessages = [
  {
    id: "msg-1",
    sessionId: "sess-abc",
    role: "user",
    content: "Hello there.",
    timestamp: "2026-01-01T00:00:00Z",
    provider: "openai",
    model: "gpt-4o-mini",
    associatedL1Ids: ["mem-1", "mem-2"],
  },
  {
    id: "msg-2",
    sessionId: "sess-abc",
    role: "assistant",
    content: "Hi, how can I help?",
    timestamp: "2026-01-01T00:00:01Z",
  },
];

const sampleBin = [
  {
    id: "msg-9",
    sessionId: "sess-abc",
    role: "user",
    content: "Removed message.",
    deletedAt: "2026-01-02T00:00:00Z",
  },
];

async function renderL0(props: Parameters<typeof import("../../../components/layers/L0Tab").default>[0] = {}) {
  const { default: L0Tab } = await import("../../../components/layers/L0Tab");
  const container = makeContainer();
  const root = createRoot(container);
  await act(async () => {
    root.render(<L0Tab {...props} />);
  });
  return { container, root };
}

describe("L0Tab", () => {
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
      if (u.includes("/api/memory/l0/messages")) return jsonResponse({ data: sampleMessages });
      if (u.includes("/api/memory/l0/recycle-bin")) return jsonResponse({ data: sampleBin });
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

  it("renders messages with public metadata only (no is_internal or combo_execution_key)", async () => {
    const { container } = await renderL0();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.querySelector("[data-testid='l0-messages']")).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/is_internal/);
    expect(container.innerHTML).not.toMatch(/combo_execution_key/);
  });

  it("renders a recycle bin row with restore and permanent-delete buttons", async () => {
    const { container } = await renderL0();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.querySelector("[data-testid='l0-recycle-msg-9']")).toBeTruthy();
    expect(container.querySelector("[data-testid='l0-restore-msg-9']")).toBeTruthy();
    expect(container.querySelector("[data-testid='l0-perm-delete-msg-9']")).toBeTruthy();
  });

  it("toggles message content visibility on expand", async () => {
    const { container } = await renderL0();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.querySelector("[data-testid='l0-content-msg-1']")).toBeNull();
    const toggle = container.querySelector("[data-testid='l0-toggle-msg-1']") as HTMLButtonElement;
    await act(async () => {
      toggle.click();
    });
    expect(container.querySelector("[data-testid='l0-content-msg-1']")).toBeTruthy();
  });

  it("opens permanent-delete modal that requires typing DELETE", async () => {
    const { container } = await renderL0();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const permBtn = container.querySelector("[data-testid='l0-perm-delete-msg-9']") as HTMLButtonElement;
    await act(async () => {
      permBtn.click();
    });
    const confirm = container.querySelector("[data-testid='l0-confirm-perm-delete']") as HTMLButtonElement;
    expect(confirm).toBeTruthy();
    expect(confirm.disabled).toBe(true);
    const input = container.querySelector("[data-testid='l0-perm-confirm-input']") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "DELETE");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      // Re-render so the controlled input shows "DELETE"
      input.focus();
    });
    await act(async () => {
      confirm.click();
    });
    const permDelCall = fetchMock.mock.calls.find(([url, init]) => {
      return (
        String(url).includes("/api/memory/l0/messages/msg-9/permanent") &&
        (init as RequestInit | undefined)?.method === "DELETE"
      );
    });
    expect(permDelCall).toBeTruthy();
  });

  it("renders an associated L1 link for messages that have one", async () => {
    const { container } = await renderL0();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.querySelector("[data-testid='l0-associated-l1-msg-1']")).toBeTruthy();
  });
});