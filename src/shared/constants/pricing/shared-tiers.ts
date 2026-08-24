/**
 * Pricing data — shared per-MTok tier constants (god-file decomposition). Pure data; merged by the barrel.
 */
export const GPT_5_3_CODEX_PRICING = {
  input: 5.0,
  output: 20.0,
  cached: 2.5,
  reasoning: 30.0,
  cache_creation: 5.0,
};

export const GPT_5_5_PRICING = {
  input: 5.0,
  output: 30.0,
  cached: 0.5,
  reasoning: 30.0,
  cache_creation: 5.0,
};

export const GPT_5_6_SOL_PRICING = {
  input: 4.0,
  output: 20.0,
  cached: 0.4,
  reasoning: 20.0,
  cache_creation: 5.0,
};

export const GPT_5_6_TERRA_PRICING = {
  input: 2.0,
  output: 12.0,
  cached: 0.2,
  reasoning: 12.0,
  cache_creation: 2.5,
};

export const GPT_5_6_LUNA_PRICING = {
  input: 0.2,
  output: 1.2,
  cached: 0.02,
  reasoning: 1.2,
  cache_creation: 0.25,
};

export const CLAUDE_FABLE_5_PRICING = {
  input: 15.0,
  output: 75.0,
  cached: 7.5,
  reasoning: 112.5,
  cache_creation: 15.0,
};

export const CLAUDE_OPUS_5_PRICING = {
  input: 5.0,
  output: 25.0,
  cached: 0.5,
  reasoning: 25.0,
  cache_creation: 6.25,
};

export const CLAUDE_OPUS_4_PRICING = {
  input: 5.0,
  output: 25.0,
  cached: 0.5,
  reasoning: 25.0,
  cache_creation: 6.25,
};

export const CLAUDE_SONNET_4_PRICING = {
  input: 3.0,
  output: 15.0,
  cached: 1.5,
  reasoning: 15.0,
  cache_creation: 3.0,
};

export const CLAUDE_OPUS_46_PRICING = {
  input: 5.0,
  output: 25.0,
  cached: 2.5,
  reasoning: 37.5,
  cache_creation: 5.0,
};

export const CLAUDE_SONNET_46_PRICING = {
  input: 3.0,
  output: 15.0,
  cached: 1.5,
  reasoning: 22.5,
  cache_creation: 3.0,
};

// Claude Sonnet 5 — Sonnet-tier current base rate.
export const CLAUDE_SONNET_5_PRICING = {
  input: 2.0,
  output: 10.0,
  cached: 0.2,
  reasoning: 10.0,
  cache_creation: 2.5,
};

export const GEMINI_37_FLASH_PRICING = {
  input: 0.75,
  output: 3.75,
  cached: 0.075,
  reasoning: 3.75,
  cache_creation: 0.75,
};

export const GEMINI_36_FLASH_PRICING = GEMINI_37_FLASH_PRICING;

export const GEMINI_35_FLASH_PRICING = {
  input: 1.5,
  output: 9.0,
  cached: 0.15,
  reasoning: 9.0,
  cache_creation: 1.5,
};

export const GEMINI_35_FLASH_LITE_PRICING = {
  input: 0.3,
  output: 2.5,
  cached: 0.03,
  reasoning: 2.5,
  cache_creation: 0.3,
};

export const GEMINI_31_PRO_PRICING = {
  input: 2.0,
  output: 12.0,
  cached: 0.2,
  reasoning: 12.0,
  cache_creation: 2.0,
};

export const GEMINI_3_FLASH_PRICING = {
  input: 0.5,
  output: 3.0,
  cached: 0.05,
  reasoning: 3.0,
  cache_creation: 0.5,
};

export const GEMINI_31_FLASH_LITE_PRICING = {
  input: 0.25,
  output: 1.5,
  cached: 0.025,
  reasoning: 1.5,
  cache_creation: 0.25,
};

export const GEMINI_25_PRO_PRICING = {
  input: 1.25,
  output: 10.0,
  cached: 0.125,
  reasoning: 10.0,
  cache_creation: 1.25,
};

export const GEMINI_25_FLASH_PRICING = {
  input: 0.3,
  output: 2.5,
  cached: 0.03,
  reasoning: 2.5,
  cache_creation: 0.3,
};

export const GEMINI_25_FLASH_LITE_PRICING = {
  input: 0.1,
  output: 0.4,
  cached: 0.01,
  reasoning: 0.4,
  cache_creation: 0.1,
};

export const KIMI_K3_PRICING = {
  input: 3.0,
  output: 15.0,
  cached: 0.3,
  reasoning: 15.0,
  cache_creation: 3.0,
};

export const KIMI_K27_CODE_PRICING = {
  input: 0.95,
  output: 4.0,
  cached: 0.19,
  reasoning: 4.0,
  cache_creation: 0.95,
};

export const KIMI_K26_PRICING = {
  input: 0.95,
  output: 4.0,
  cached: 0.16,
  reasoning: 4.0,
  cache_creation: 0.95,
};

export const GLM_PRICING = {
  "glm-5.2": {
    input: 1.2,
    output: 5,
    cached: 0.3,
    reasoning: 5,
    cache_creation: 1.2,
  },
  "glm-5.2-high": {
    input: 1.2,
    output: 5,
    cached: 0.3,
    reasoning: 5,
    cache_creation: 1.2,
  },
  "glm-5.2-max": {
    input: 1.2,
    output: 5,
    cached: 0.3,
    reasoning: 5,
    cache_creation: 1.2,
  },
  "glm-5.1": {
    input: 1.2,
    output: 5,
    cached: 0.3,
    reasoning: 5,
    cache_creation: 1.2,
  },
  "glm-5": {
    input: 1.0,
    output: 3.2,
    cached: 0.2,
    reasoning: 4.8,
    cache_creation: 1.0,
  },
  "glm-5-turbo": {
    input: 1.2,
    output: 4.0,
    cached: 0.24,
    reasoning: 4.0,
    cache_creation: 1.2,
  },
  "glm-4.7-flash": {
    input: 0,
    output: 0,
    cached: 0,
    reasoning: 0,
    cache_creation: 0,
  },
  "glm-4.7": {
    input: 0.6,
    output: 2.2,
    cached: 0.11,
    reasoning: 2.2,
    cache_creation: 0.6,
  },
  "glm-4.6": {
    input: 0.6,
    output: 2.2,
    cached: 0.11,
    reasoning: 2.2,
    cache_creation: 0.6,
  },
  "glm-4.6v": {
    input: 0.3,
    output: 0.9,
    cached: 0.05,
    reasoning: 0.9,
    cache_creation: 0.3,
  },
  "glm-4.5v": {
    input: 0.6,
    output: 1.8,
    cached: 0.11,
    reasoning: 1.8,
    cache_creation: 0.6,
  },
  "glm-4.5": {
    input: 0.6,
    output: 2.2,
    cached: 0.11,
    reasoning: 2.2,
    cache_creation: 0.6,
  },
  "glm-4.5-air": {
    input: 0.2,
    output: 1.1,
    cached: 0.03,
    reasoning: 1.1,
    cache_creation: 0.2,
  },
};
