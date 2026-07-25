import { describe, expect, it } from "vitest";
import { getDeployBasePath, normalizeBasePath, withBasePath } from "../basePath";

describe("normalizeBasePath", () => {
  it("normalizes leading/trailing slashes", () => {
    expect(normalizeBasePath("omniroute")).toBe("/omniroute");
    expect(normalizeBasePath("/omniroute/")).toBe("/omniroute");
    expect(normalizeBasePath("/omniroute")).toBe("/omniroute");
    expect(normalizeBasePath("")).toBe("");
    expect(normalizeBasePath("/")).toBe("");
    expect(normalizeBasePath(null)).toBe("");
  });
});

describe("getDeployBasePath", () => {
  it("reads NEXT_PUBLIC_OMNIROUTE_BASE_PATH first", () => {
    expect(
      getDeployBasePath({
        NEXT_PUBLIC_OMNIROUTE_BASE_PATH: "/omniroute",
        OMNIROUTE_BASE_PATH: "/other",
      } as NodeJS.ProcessEnv)
    ).toBe("/omniroute");
  });

  it("falls back to OMNIROUTE_BASE_PATH", () => {
    expect(
      getDeployBasePath({
        OMNIROUTE_BASE_PATH: "/omniroute",
      } as NodeJS.ProcessEnv)
    ).toBe("/omniroute");
  });
});

describe("withBasePath", () => {
  const base = "/omniroute";

  it("is a no-op when basePath is empty", () => {
    expect(withBasePath("/api/health/ping", "")).toBe("/api/health/ping");
  });

  it("prefixes absolute app paths", () => {
    expect(withBasePath("/api/health/ping", base)).toBe("/omniroute/api/health/ping");
    expect(withBasePath("/v1/models", base)).toBe("/omniroute/v1/models");
  });

  it("does not double-prefix", () => {
    expect(withBasePath("/omniroute/api/health/ping", base)).toBe("/omniroute/api/health/ping");
    expect(withBasePath("/omniroute", base)).toBe("/omniroute");
  });

  it("rewrites same-origin absolute URLs", () => {
    expect(withBasePath("https://host.example/api/x", base, "https://host.example")).toBe(
      "https://host.example/omniroute/api/x"
    );
  });

  it("leaves external absolute URLs alone", () => {
    expect(withBasePath("https://other.example/api/x", base, "https://host.example")).toBe(
      "https://other.example/api/x"
    );
  });

  it("leaves protocol-relative URLs alone", () => {
    expect(withBasePath("//cdn.example/app.js", base)).toBe("//cdn.example/app.js");
  });
});
