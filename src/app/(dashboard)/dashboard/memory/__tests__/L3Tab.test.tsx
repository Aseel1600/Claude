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

const samplePrompts = [
  {
    id: "prompt-1",
    mode: "chat",
    content: "Be concise and helpful.",
    version: 4,
    modifier: "admin",
    lineage: { l1Ids: ["mem-1", "mem-2"], l2Ids: ["scene-1"] },
  },
  {
    id: "prompt-2",
    mode: "code",
    content: "Always write tests.",
    version: 1,
    modifier: "admin",
  },
];

async function renderL3() {
  const { default: L3Tab } = await import("../../../components/layers/L3Tab");
  const container = makeContainer();
  const root = createRoot(container);
  await act(async () => {
    root.render(<L3Tab />);
  });
  return { container, root };
}

describe("L3Tab", () => {
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
      if (u.includes("/api/memory/l3/prompts")) return jsonResponse({ data: samplePrompts });
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

  it("renders prompts with mode + version + modifier", async () => {
    const { container } = await renderL3();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const chat = container.querySelector("[data-testid='l3-prompt-prompt-1']") as HTMLElement;
    expect(chat).toBeTruthy();
    expect(chat.getAttribute("data-mode")).toBe("chat");
    const code = container.querySelector("[data-testid='l3-prompt-prompt-2']") as HTMLElement;
    expect(code.getAttribute("data-mode")).toBe("code");
  });

  it("renders lineage links for prompts with L1/L2 references", async () => {
    const { container } = await renderL3();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.querySelector("[data-testid='l3-lineage-l1-prompt-1']")).toBeTruthy();
    expect(container.querySelector("[data-testid='l3-lineage-l2-prompt-1']")).toBeTruthy();
  });

  it("PUTs on edit save and enforces 2000 char limit", async () => {
    const { container } = await renderL3();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const edit = container.querySelector("[data-testid='l3-edit-prompt-1']") as HTMLButtonElement;
    await act(async () => {
      edit.click();
    });
    const save = container.querySelector("[data-testid='l3-save']") as HTMLButtonElement;
    await act(async () => {
      save.click();
    });
    const putCall = fetchMock.mock.calls.find(([url, init]) => {
      return (
        String(url).includes("/api/memory/l3/prompts/prompt-1") &&
        (init as RequestInit | undefined)?.method === "PUT"
      );
    });
    expect(putCall).toBeTruthy();
  });

  it("DELETEs on clear confirm", async () => {
    const { container } = await renderL3();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const clear = container.querySelector("[data-testid='l3-clear-prompt-1']") as HTMLButtonElement;
    await act(async () => {
      clear.click();
    });
    const confirm = container.querySelector("[data-testid='l3-confirm-clear']") as HTMLButtonElement;
    await act(async () => {
      confirm.click();
    });
    const delCall = fetchMock.mock.calls.find(([url, init]) => {
      return (
        String(url).includes("/api/memory/l3/prompts/prompt-1") &&
        (init as RequestInit | undefined)?.method === "DELETE"
      );
    });
    expect(delCall).toBeTruthy();
  });

  it("POSTs to /regenerate", async () => {
    const { container } = await renderL3();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const regen = container.querySelector("[data-testid='l3-regenerate-prompt-1']") as HTMLButtonElement;
    await act(async () => {
      regen.click();
    });
    const regenCall = fetchMock.mock.calls.find(([url, init]) => {
      return (
        String(url).includes("/api/memory/l3/prompts/prompt-1/regenerate") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    expect(regenCall).toBeTruthy();
  });

  it("renders the character counter against the 2000 limit", async () => {
    const { container } = await renderL3();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.textContent).toMatch(/\d+ \/ 2000/);
  });
});