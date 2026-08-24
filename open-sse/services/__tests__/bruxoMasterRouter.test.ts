import { describe, expect, it } from "vitest";
import {
  normalizeBruxoRoutingConfig,
  resolveBruxoRoute,
  type BruxoRoutingConfig,
} from "../bruxoMasterRouter.ts";

const config: BruxoRoutingConfig = {
  enabled: true,
  entryModels: ["BRUXO"],
  fallbackCategory: "analyser",
  maxFallbackLevel: "xhigh",
  routes: {
    coder: {
      mid: "coder-mid",
      high: "coder-high",
      xhigh: "coder-xhigh",
    },
    agentic: {
      mid: "agentic-mid",
      high: "agentic-high",
      xhigh: "agentic-xhigh",
      tools: "agentic-tools",
    },
    analyser: {
      mid: "analyser-mid",
      high: "analyser-high",
      xhigh: "analyser-xhigh",
    },
  },
};

function body(content: string, tools?: unknown[]) {
  return {
    messages: [{ role: "user", content }],
    ...(tools ? { tools } : {}),
  };
}

describe("BRUXO Master Router", () => {
  it("does not alter non-entry models", () => {
    expect(resolveBruxoRoute("other", body("fix this TypeScript error"), config)).toEqual({
      matched: false,
    });
  });

  it("rejects disabled, malformed, and recursive persisted route settings", () => {
    expect(normalizeBruxoRoutingConfig({ enabled: false })).toBeNull();
    expect(normalizeBruxoRoutingConfig({ enabled: true, routes: {} })).toBeNull();
    expect(
      normalizeBruxoRoutingConfig({
        enabled: true,
        entryModels: ["BRUXO"],
        routes: { coder: { mid: "BRUXO" } },
      })
    ).toBeNull();
  });

  it("routes a coding task to the configured coder combo", () => {
    const result = resolveBruxoRoute("BRUXO", body("Fix this TypeScript function"), config);
    expect(result.matched).toBe(true);
    expect(result.category).toBe("coder");
    expect(result.resolvedCombo).toBe("coder-mid");
  });

  it("keeps required tools separate from the semantic task type", () => {
    const result = resolveBruxoRoute(
      "bruxo",
      body("Read this file", [{ type: "function", function: { name: "read_file" } }]),
      config
    );
    expect(result.mode).toBe("agent");
    expect(result.taskType).toBe("general");
    expect(result.toolUse).toBe("required");
    expect(result.category).toBe("analyser");
    expect(result.level).toBe("mid");
    expect(result.resolvedCombo).toBe("analyser-mid");
  });

  it("classifies explicit multi-task as agentic without using tools as a route", () => {
    const result = resolveBruxoRoute(
      "bruxo",
      body("[B] MULTI-TASK: leia o arquivo e resuma", [
        { type: "function", function: { name: "read_file" } },
      ]),
      config
    );
    expect(result.mode).toBe("multi-task");
    expect(result.taskType).toBe("agentic");
    expect(result.toolUse).toBe("required");
    expect(result.level).toBe("mid");
    expect(result.category).toBe("agentic");
    expect(result.resolvedCombo).toBe("agentic-mid");
  });

  it("classifies explicit subagent work as agentic without using tools as a route", () => {
    const result = resolveBruxoRoute(
      "bruxo",
      body("[B] SUBAGENT: verifique este log", [
        { type: "function", function: { name: "read_file" } },
      ]),
      config
    );
    expect(result.mode).toBe("subagent");
    expect(result.taskType).toBe("agentic");
    expect(result.toolUse).toBe("required");
    expect(result.level).toBe("mid");
    expect(result.category).toBe("agentic");
    expect(result.resolvedCombo).toBe("agentic-mid");
  });

  it("recognizes the execution-mode header used by the orchestrator", () => {
    const result = resolveBruxoRoute("bruxo", body("verifique este log"), config, {
      "x-omniroute-execution-mode": "subagent",
    });
    expect(result.mode).toBe("subagent");
    expect(result.taskType).toBe("agentic");
    expect(result.resolvedCombo).toBe("agentic-mid");
  });

  it("applies the multi-task floor only to the semantic agentic lane", () => {
    const result = resolveBruxoRoute(
      "bruxo",
      body("[B] MULTI-TASK: leia o arquivo e resuma", [
        { type: "function", function: { name: "read_file" } },
      ]),
      { ...config, levelFloors: { multiTask: "xhigh" } }
    );
    expect(result.category).toBe("agentic");
    expect(result.level).toBe("xhigh");
    expect(result.resolvedCombo).toBe("agentic-xhigh");
  });

  it("preserves coding intent when Agent carries tools", () => {
    const result = resolveBruxoRoute(
      "bruxo",
      body("Implement this TypeScript function", [
        { type: "function", function: { name: "read_file" } },
      ]),
      config
    );
    expect(result.mode).toBe("agent");
    expect(result.taskType).toBe("coder");
    expect(result.toolUse).toBe("required");
    expect(result.category).toBe("coder");
    expect(result.level).toBe("mid");
    expect(result.resolvedCombo).toBe("coder-mid");
  });

  it("keeps available tools neutral for ask and plan modes", () => {
    const result = resolveBruxoRoute(
      "bruxo",
      body("Ask: explique rapidamente o status", [
        { type: "function", function: { name: "read_file" } },
      ]),
      config
    );
    expect(result.mode).toBe("ask");
    expect(result.toolUse).toBe("available");
    expect(result.level).toBe("mid");
    expect(result.resolvedCombo).toBe("analyser-mid");
  });

  it("supports explicit X-OmniRoute-Level header override", () => {
    const result = resolveBruxoRoute("BRUXO", body("Fix this TypeScript function"), config, {
      "x-omniroute-level": "max",
    });
    expect(result.level).toBe("xhigh"); // max falls back to xhigh when max route is absent
    expect(result.resolvedCombo).toBe("coder-xhigh");
  });

  it("uses a dedicated route matrix for the obruxo-free entry", () => {
    const dualConfig = normalizeBruxoRoutingConfig({
      ...config,
      entryModels: ["obruxo", "obruxo-free"],
      entryRoutes: {
        "obruxo-free": {
          coder: { mid: "coder-free-mid", high: "coder-free-high", xhigh: "coder-free-xhigh" },
          agentic: {
            mid: "agentic-free-mid",
            high: "agentic-free-high",
            xhigh: "agentic-free-xhigh",
            tools: "agentic-free-tools",
          },
          analyser: {
            mid: "analyser-free-mid",
            high: "analyser-free-high",
            xhigh: "analyser-free-xhigh",
          },
        },
      },
    });
    expect(dualConfig).not.toBeNull();
    expect(
      resolveBruxoRoute("obruxo-free", body("Fix this TypeScript function"), dualConfig)
        .resolvedCombo
    ).toBe("coder-free-mid");
    expect(
      resolveBruxoRoute("obruxo", body("Fix this TypeScript function"), dualConfig).resolvedCombo
    ).toBe("coder-mid");
    expect(
      resolveBruxoRoute(
        "obruxo-free",
        body("Read this file", [{ type: "function", function: { name: "read_file" } }]),
        dualConfig
      ).resolvedCombo
    ).toBe("analyser-free-mid");
  });

  it("keeps required tools on the tools route even when large context raises the level", () => {
    const dualConfig = normalizeBruxoRoutingConfig({
      ...config,
      entryModels: ["obruxo", "obruxo-free"],
      entryRoutes: {
        "obruxo-free": {
          coder: { mid: "coder-free-mid", high: "coder-free-high", xhigh: "coder-free-xhigh" },
          agentic: {
            mid: "agentic-free-mid",
            high: "agentic-free-high",
            xhigh: "agentic-free-xhigh",
            tools: "agentic-free-tools",
          },
          analyser: {
            mid: "analyser-free-mid",
            high: "analyser-free-high",
            xhigh: "analyser-free-xhigh",
          },
        },
      },
    });
    const largeToolBody = {
      messages: Array.from({ length: 501 }, (_, index) => ({
        role: index === 500 ? "user" : "assistant",
        content: index === 500 ? "[B] SUBAGENT: analise o repositório" : "contexto",
      })),
      tools: [{ type: "function", function: { name: "read_file" } }],
    };

    const result = resolveBruxoRoute("obruxo-free", largeToolBody, dualConfig);

    expect(result.mode).toBe("subagent");
    expect(result.toolUse).toBe("required");
    expect(result.taskType).toBe("agentic");
    expect(result.resolvedCombo).toBe("agentic-free-xhigh");
  });

  it("detects review as its own task type and falls back through coder when no reviewer route exists", () => {
    const result = resolveBruxoRoute("BRUXO", body("Please review this TypeScript change"), config);
    expect(result.taskType).toBe("reviewer");
    expect(result.category).toBe("coder");
    expect(result.resolvedCombo).toBe("coder-mid");
    expect(result.fallbackApplied).toBe(true);
  });

  it("keeps explicit reviewer routes when configured", () => {
    const reviewConfig: BruxoRoutingConfig = {
      ...config,
      routes: {
        ...config.routes,
        reviewer: { mid: "reviewer-mid", high: "reviewer-high", xhigh: "reviewer-xhigh" },
      },
    };
    const result = resolveBruxoRoute(
      "BRUXO",
      body("Please review this TypeScript change"),
      reviewConfig
    );
    expect(result.taskType).toBe("reviewer");
    expect(result.category).toBe("reviewer");
    expect(result.resolvedCombo).toBe("reviewer-mid");
  });

  it("uses the configured category fallback only when its route exists", () => {
    const analyserOnly: BruxoRoutingConfig = {
      ...config,
      routes: { analyser: { mid: "analyser-mid" } },
    };
    const result = resolveBruxoRoute("BRUXO", body("Fix this JavaScript function"), analyserOnly);
    expect(result.category).toBe("analyser");
    expect(result.resolvedCombo).toBe("analyser-mid");
    expect(result.fallbackApplied).toBe(true);
  });

  it("keeps the former agentic-tools route as a last-resort compatibility fallback", () => {
    const legacyOnly: BruxoRoutingConfig = {
      enabled: true,
      entryModels: ["BRUXO"],
      routes: { agentic: { tools: "agentic-tools" } },
    };
    const result = resolveBruxoRoute(
      "BRUXO",
      body("Read this file", [{ type: "function", function: { name: "read_file" } }]),
      legacyOnly
    );
    expect(result.category).toBe("agentic");
    expect(result.resolvedCombo).toBe("agentic-tools");
    expect(result.fallbackApplied).toBe(true);
  });
});
