import { describe, expect, it } from "vitest";
import {
  getProviderCapacity,
  hasDocumentedProviderCapacity,
  normalizeProviderCapacity,
} from "../providerCapacity.ts";

describe("provider capacity normalization", () => {
  it("preserves documented RPM/RPH/RPD", () => {
    const capacity = getProviderCapacity("agnes");

    expect(capacity.documented).toBe(true);
    expect(capacity.requestsPerMinute).toBe(20);
    expect(capacity.requestsPerHour).toBe(1200);
    expect(capacity.requestsPerDay).toBeNull();
  });

  it("does not confuse token/day allowances with request/day quotas", () => {
    const capacity = getProviderCapacity("navy");

    expect(capacity.allowanceAmount).toBe(150000);
    expect(capacity.allowanceUnit).toBe("tokens/day");
    expect(capacity.tokensPerDay).toBe(150000);
    expect(capacity.requestsPerDay).toBe(150000);
  });

  it("preserves documented token capacity", () => {
    const capacity = getProviderCapacity("navy");

    expect(capacity.documented).toBe(true);
    expect(capacity.tokensPerDay).toBe(150000);
    expect(capacity.requestsPerMinute).toBe(20);
  });

  it("preserves BazaarLink request limits", () => {
    const capacity = getProviderCapacity("bazaarlink");

    expect(capacity.documented).toBe(true);
    expect(capacity.requestsPerMinute).toBe(10);
    expect(capacity.requestsPerHour).toBe(600);
    expect(capacity.requestsPerDay).toBe(100);
  });

  it("does not convert unknown capacity to zero", () => {
    const capacity = getProviderCapacity("adapta-web");

    expect(capacity.requestsPerMinute).toBeNull();
    expect(capacity.requestsPerHour).toBeNull();
    expect(capacity.requestsPerDay).toBeNull();
    expect(capacity.tokensPerMinute).toBeNull();
    expect(capacity.concurrency).toBeNull();
  });

  it("reports whether documented capacity exists", () => {
    expect(hasDocumentedProviderCapacity("navy")).toBe(true);
    expect(hasDocumentedProviderCapacity("agnes")).toBe(true);
  });

  it("returns an empty normalized object for unknown providers", () => {
    const capacity = normalizeProviderCapacity(null);

    expect(capacity.documented).toBe(false);
    expect(capacity.requestsPerMinute).toBeNull();
    expect(capacity.requestsPerDay).toBeNull();
    expect(capacity.tokensPerDay).toBeNull();
    expect(capacity.concurrency).toBeNull();
  });
});
