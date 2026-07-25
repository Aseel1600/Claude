// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetBasePathFetchForTests, installBasePathFetch } from "../basePathFetch";

describe("installBasePathFetch", () => {
  afterEach(() => {
    __resetBasePathFetchForTests();
    vi.unstubAllGlobals();
  });

  it("is a no-op when basePath is empty", async () => {
    const native = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", native);

    const uninstall = installBasePathFetch("");
    await fetch("/api/health/ping");
    expect(native).toHaveBeenCalledWith("/api/health/ping", undefined);
    uninstall();
  });

  it("prefixes absolute paths on fetch when basePath is set", async () => {
    const native = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", native);

    const uninstall = installBasePathFetch("/omniroute");
    await fetch("/api/health/ping");
    expect(native).toHaveBeenCalledWith("/omniroute/api/health/ping", undefined);
    uninstall();
  });

  it("does not double-prefix already-prefixed paths", async () => {
    const native = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", native);

    const uninstall = installBasePathFetch("/omniroute");
    await fetch("/omniroute/api/health/ping");
    expect(native).toHaveBeenCalledWith("/omniroute/api/health/ping", undefined);
    uninstall();
  });

  it("restores native fetch after last uninstall", async () => {
    const native = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", native);

    const a = installBasePathFetch("/omniroute");
    const b = installBasePathFetch("/omniroute");
    a();
    await fetch("/api/x");
    expect(native).toHaveBeenCalledWith("/omniroute/api/x", undefined);
    b();
    native.mockClear();
    await fetch("/api/x");
    expect(native).toHaveBeenCalledWith("/api/x", undefined);
  });
});
