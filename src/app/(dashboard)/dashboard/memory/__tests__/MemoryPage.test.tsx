// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockSearchParams: Record<string, string> = {};
const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => mockSearchParams[key] ?? null,
    toString: () =>
      Object.entries(mockSearchParams)
        .map(([k, v]) => `${k}=${v}`)
        .join("&"),
  }),
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

const layers: Record<string, React.FC> = {};
function registerLayer(testId: string, Component: React.FC) {
  layers[testId] = Component;
}

vi.mock("../../../src/app/(dashboard)/dashboard/memory/components/MemoryConceptCard", () => ({
  default: () => React.createElement("div", { "data-testid": "concept-card" }, "ConceptCard"),
}));

vi.mock(
  "../../../src/app/(dashboard)/dashboard/memory/components/layers/L0Tab",
  () => ({
    default: () => {
      const C = layers.l0 ?? (() => null);
      return React.createElement(C, { "data-testid": "l0-tab-content" });
    },
  })
);
vi.mock(
  "../../../src/app/(dashboard)/dashboard/memory/components/layers/L1Tab",
  () => ({
    default: (props: { lineageFilter?: string[] | null; onClearLineage?: () => void }) => {
      const C = layers.l1 ?? (() => null);
      return React.createElement(C, { "data-testid": "l1-tab-content", ...props });
    },
  })
);
vi.mock(
  "../../../src/app/(dashboard)/dashboard/memory/components/layers/L2Tab",
  () => ({
    default: () => {
      const C = layers.l2 ?? (() => null);
      return React.createElement(C, { "data-testid": "l2-tab-content" });
    },
  })
);
vi.mock(
  "../../../src/app/(dashboard)/dashboard/memory/components/layers/L3Tab",
  () => ({
    default: () => {
      const C = layers.l3 ?? (() => null);
      return React.createElement(C, { "data-testid": "l3-tab-content" });
    },
  })
);
vi.mock(
  "../../../src/app/(dashboard)/dashboard/memory/components/layers/DistillationSettingsTab",
  () => ({
    default: () => {
      const C = layers.settings ?? (() => null);
      return React.createElement(C, { "data-testid": "settings-tab-content" });
    },
  })
);

const cleanupCallbacks: Array<() => void> = [];

function makeContainer(): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  cleanupCallbacks.push(() => container.remove());
  return container;
}

async function renderMemoryPage() {
  const { default: MemoryPage } = await import(
    "../../../src/app/(dashboard)/dashboard/memory/page"
  );
  const container = makeContainer();
  const root = createRoot(container);
  await act(async () => {
    root.render(<MemoryPage />);
  });
  return { container, root };
}

describe("MemoryPage (rewritten four-layer)", () => {
  beforeEach(() => {
    mockSearchParams = {};
    replaceMock.mockReset();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    // Register minimal stand-in components for each layer
    registerLayer("l0", () => React.createElement("div", null, "L0"));
    registerLayer("l1", () => React.createElement("div", null, "L1"));
    registerLayer("l2", () => React.createElement("div", null, "L2"));
    registerLayer("l3", () => React.createElement("div", null, "L3"));
    registerLayer("settings", () => React.createElement("div", null, "Settings"));
  });

  afterEach(() => {
    while (cleanupCallbacks.length > 0) cleanupCallbacks.pop()?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders the concept card", async () => {
    const { container } = await renderMemoryPage();
    expect(container.querySelector("[data-testid='concept-card']")).toBeTruthy();
  });

  it("renders 5 tab buttons (l0, l1, l2, l3, settings)", async () => {
    const { container } = await renderMemoryPage();
    for (const tab of ["l0", "l1", "l2", "l3", "settings"]) {
      expect(container.querySelector(`[data-testid='tab-${tab}']`)).toBeTruthy();
    }
  });

  it("defaults to l0 tab when no query param is set", async () => {
    const { container } = await renderMemoryPage();
    expect(container.querySelector("[data-testid='l0-tab-content']")).toBeTruthy();
    expect(container.querySelector("[data-testid='l1-tab-content']")).toBeNull();
    expect(container.querySelector("[data-testid='settings-tab-content']")).toBeNull();
  });

  it("switches to settings tab when ?tab=settings", async () => {
    mockSearchParams = { tab: "settings" };
    const { container } = await renderMemoryPage();
    expect(container.querySelector("[data-testid='settings-tab-content']")).toBeTruthy();
    expect(container.querySelector("[data-testid='l0-tab-content']")).toBeNull();
  });

  it("calls router.replace with lineage on tab switch from L0 to L1", async () => {
    mockSearchParams = { tab: "l0", lineage: "abc" };
    const { container } = await renderMemoryPage();
    const l1Btn = container.querySelector("[data-testid='tab-l1']") as HTMLButtonElement;
    await act(async () => {
      l1Btn.click();
    });
    expect(replaceMock).toHaveBeenCalled();
    const lastCall = replaceMock.mock.calls[replaceMock.mock.calls.length - 1];
    expect(String(lastCall[0])).toContain("tab=l1");
  });

  it("passes lineage filter to L1 tab", async () => {
    mockSearchParams = { tab: "l1", lineage: "mem-1,mem-2" };
    registerLayer("l1", (props: { lineageFilter?: string[] | null }) =>
      React.createElement(
        "div",
        { "data-testid": "l1-lineage-receiver" },
        JSON.stringify(props.lineageFilter ?? null)
      )
    );
    await renderMemoryPage();
    const el = document.querySelector("[data-testid='l1-lineage-receiver']");
    expect(el?.textContent).toBe(JSON.stringify(["mem-1", "mem-2"]));
  });

  it("shows the lineage filter chip with a clear button when lineage is set", async () => {
    mockSearchParams = { tab: "l1", lineage: "mem-1" };
    const { container } = await renderMemoryPage();
    expect(container.querySelector("[data-testid='lineage-chip']")).toBeTruthy();
    const btn = container.querySelector("[data-testid='clear-lineage']") as HTMLButtonElement;
    await act(async () => {
      btn.click();
    });
    expect(replaceMock).toHaveBeenCalled();
    const lastCall = replaceMock.mock.calls[replaceMock.mock.calls.length - 1];
    expect(String(lastCall[0])).not.toContain("lineage=");
  });

  it("does not show the lineage chip on the settings tab even when lineage is set", async () => {
    mockSearchParams = { tab: "settings", lineage: "mem-1" };
    const { container } = await renderMemoryPage();
    expect(container.querySelector("[data-testid='lineage-chip']")).toBeNull();
  });
});