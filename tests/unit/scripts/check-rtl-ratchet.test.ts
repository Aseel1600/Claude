import { describe, it, expect } from "vitest";

import { countViolations } from "../../../scripts/check/check-rtl-ratchet.mjs";

describe("check-rtl-ratchet — countViolations", () => {
  it("counts physical directional utilities", () => {
    expect(countViolations('<span className="mr-2" />')).toBe(1);
    expect(countViolations('<td className="pr-3 text-left" />')).toBe(2);
    expect(countViolations('<div className="border-l-2 rounded-r-md" />')).toBe(2);
  });

  it("ignores logical utilities, which already mirror", () => {
    expect(countViolations('<span className="me-2 ps-3 text-start" />')).toBe(0);
    expect(countViolations('<div className="border-s-2 rounded-e-md" />')).toBe(0);
  });

  it("ignores a class already scoped to an rtl: variant", () => {
    expect(countViolations('<div className="rtl:mr-0" />')).toBe(0);
    // Only the unscoped half of a pair counts.
    expect(countViolations('<div className="rtl:mr-0 mr-2" />')).toBe(1);
  });

  it("ignores left/right paired on one element, which spans both edges", () => {
    expect(countViolations('<div className="absolute left-0 right-0 top-0" />')).toBe(0);
    // A lone edge offset is still directional.
    expect(countViolations('<div className="absolute left-0 top-0" />')).toBe(1);
  });

  it("does not match unrelated identifiers containing the prefixes", () => {
    expect(countViolations('<div className="control-panel highlight-2" />')).toBe(0);
    expect(countViolations("const marginLeft = 2;")).toBe(0);
  });
});
