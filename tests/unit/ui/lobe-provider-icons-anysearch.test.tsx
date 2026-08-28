import { describe, expect, it } from "vitest";

import { getLobeProviderIcon } from "@/shared/components/lobeProviderIcons";

describe("AnySearch provider icon fallback", () => {
  it.each(["anysearch", "anysearch-search"])(
    "falls through when LobeHub has no icon for %s",
    (providerId) => {
      expect(getLobeProviderIcon(providerId)).toBeNull();
    }
  );
});

describe("unknown provider icon fallback", () => {
  it.each(["constructor", "valueOf", "hasOwnProperty", "__proto__"])(
    "does not resolve inherited object property %s as an icon",
    (providerId) => {
      expect(getLobeProviderIcon(providerId)).toBeNull();
    }
  );
});
