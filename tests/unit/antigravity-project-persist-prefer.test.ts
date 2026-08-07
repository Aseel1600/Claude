import { describe, it } from "node:test";
import assert from "node:assert";
import { preferAntigravityConnectionsWithStoredProject } from "../../open-sse/services/antigravityProjectPersist.ts";

describe("preferAntigravityConnectionsWithStoredProject (#8894)", () => {
  it("surfaces connections with a top-level projectId first", () => {
    const conns = [
      { id: "a", projectId: null },
      { id: "b", projectId: "proj-b" },
      { id: "c", projectId: undefined },
    ];
    const ranked = preferAntigravityConnectionsWithStoredProject(conns);
    assert.strictEqual(ranked[0].id, "b");
    assert.deepStrictEqual(
      ranked.map((c) => c.id),
      ["b", "a", "c"]
    );
  });

  it("treats providerSpecificData.projectId as a stored project", () => {
    const conns = [
      { id: "a", providerSpecificData: { other: 1 } },
      { id: "b", providerSpecificData: { projectId: "proj-b" } },
    ];
    const ranked = preferAntigravityConnectionsWithStoredProject(conns);
    assert.strictEqual(ranked[0].id, "b");
  });

  it("is stable within each group and non-mutating", () => {
    const conns = [
      { id: "no1", projectId: null },
      { id: "yes1", projectId: "p1" },
      { id: "no2", projectId: null },
      { id: "yes2", projectId: "p2" },
    ];
    const snapshot = conns.map((c) => c.id);
    const ranked = preferAntigravityConnectionsWithStoredProject(conns);
    assert.deepStrictEqual(
      ranked.map((c) => c.id),
      ["yes1", "yes2", "no1", "no2"]
    );
    // input untouched
    assert.deepStrictEqual(
      conns.map((c) => c.id),
      snapshot
    );
  });

  it("returns an empty array unchanged", () => {
    assert.deepStrictEqual(preferAntigravityConnectionsWithStoredProject([]), []);
  });
});
