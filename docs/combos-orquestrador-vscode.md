# Combos do Orquestrador Obruxo — Lista para VS Code

> Todos os combos criados e testados em 2026-08-21.
> Endpoint: `http://localhost:20131/v1/chat/completions`
> API Key: `sk-fa8b89bf3d3ffd7f-9d5f48-2d6d88d7`

---

## 🟢 Tier EASY (Tarefas Leves)

### `orq-easy`

- **Contexto:** 1M | **Strategy:** auto
- **Descrição:** Tarefas leves — leitura, busca, doc, diagnóstico simples
- **Pool:** deepseek-v4-flash, GEMINI FLASH [1M], GEMINI LITE [1M], CURSOR AUTO

### `orq-free-easy`

- **Contexto:** 1M | **Strategy:** auto
- **Descrição:** FREE tier — tarefas leves, velocidade máxima. Groq 20B principal
- **Pool:** groq/gpt-oss-20b (peso 40), llama-3.1-8b (25), gemini-3.1-flash-lite (20), nemotron-nano-30b (15)

### `orq-speed-128k`

- **Contexto:** 128K | **Strategy:** auto
- **Descrição:** SPEED 128K — Groq LPU ultra-rápido + Kimi K3 + DeepSeek
- **Pool:** groq/gpt-oss-120b (30), groq/gpt-oss-20b (25), kimi-k3 (20), deepseek-v4-flash (15), llama-3.1-8b (10)

---

## 🟡 Tier MEDIUM (Dev Normal)

### `orq-medium`

- **Contexto:** 1M | **Strategy:** auto
- **Descrição:** Dev normal — implementar, bug comum, refactor moderado
- **Pool:** KIMI CODE, KIMI [1M], deepseek-v4-flash, GEMINI FLASH [1M], CURSOR COMPOSER

### `orq-free-medium`

- **Contexto:** 1M | **Strategy:** auto
- **Descrição:** FREE tier — dev normal. Groq 120B + Gemini 3.5-flash
- **Pool:** groq/gpt-oss-120b (35), gemini-3.5-flash (30), deepseek-v4-flash-0731 (20), kimi-k3 (15)

### `orq-speed-256k`

- **Contexto:** 256K | **Strategy:** auto
- **Descrição:** SPEED 256K — Nemotron 3 NVIDIA (gratuito)
- **Pool:** nemotron-3-ultra-550b (40), nemotron-3.5-lightning (35), nemotron-nano-30b (25)

---

## 🔴 Tier HARD (Arquitetura & Bugs Críticos)

### `orq-hard`

- **Contexto:** 1M | **Strategy:** auto
- **Descrição:** Arquitetura, bugs difíceis, segurança, migração, revisão profunda
- **Pool:** CLAUDE OPUS [1M] (40), CLAUDE VALUE [1M] (25), GEMINI PRO [1M] (20), KIMI [1M] (15)

### `orq-free-hard`

- **Contexto:** 250K | **Strategy:** fusion
- **Descrição:** FREE tier — raciocínio profundo. Fusion: 3 Nemotron 256K + Gemini + deepseek judge
- **Panel:** nemotron-3-super-120b, nemotron-3-ultra-550b, nemotron-nano-30b, gemini-3.5-flash
- **Judge:** deepseek-v4-flash-0731

---

## 🔵 Tier AUTO (Pool Misto)

### `orq-auto`

- **Contexto:** 1M | **Strategy:** auto
- **Descrição:** Sistema escolhe o esforço — pool misto, exploração alta
- **Pool:** deepseek-v4-flash (20), GEMINI FLASH (15), KIMI CODE (20), KIMI [1M] (15), CLAUDE VALUE (15), CLAUDE OPUS (10), GEMINI PRO (5), CURSOR AUTO (15), CURSOR COMPOSER (15), CURSOR GROK (10)

### `orq-free-auto`

- **Contexto:** 1M | **Strategy:** auto
- **Descrição:** FREE tier — pool misto Groq+Gemini+NVIDIA, exploração alta
- **Pool:** groq/gpt-oss-120b (20), groq/gpt-oss-20b (15), gemini-3.5-flash (20), gemini-3.1-flash-lite (10), deepseek-v4-flash-0731 (15), kimi-k3 (10), nemotron-3-super-120b (10)

---

## 🚀 Tier PREMIUM (Top Performance)

### `orq-premium-speed`

- **Contexto:** 1M | **Strategy:** auto
- **Descrição:** PREMIUM SPEED — Velocidade máxima (<1.5s). Groq + Terra Max + Opus Fast
- **Pool:** groq/gpt-oss-20b (30), cx/gpt-5.6-terra-max (25), claude-opus-4-8-xhigh-fast (20), gemini-2.5-flash (15), composer-2.5-fast (10)

### `orq-premium-speed-1m`

- **Contexto:** 1M | **Strategy:** auto
- **Descrição:** PREMIUM SPEED 1M — O mais rápido com 1M de contexto. Claude Opus Fast + Gemini + Kimi K3 + Grok
- **Pool:** claude-opus-4-8-xhigh-fast (25), claude-opus-4-8-thinking-max-fast (20), gemini-3.1-pro (15), claude-4.6-opus-max-thinking (10), grok-4.5-fast-xhigh (10), kimi-k3 (10), gemini-3.5-flash (5)

### `orq-premium-medium`

- **Contexto:** 1M | **Strategy:** auto
- **Descrição:** PREMIUM MEDIUM — Dev dia a dia. Claude Sonnet 5 + Kimi K3 1M + Terra Max
- **Pool:** claude-sonnet-5 (35), kimi-k3 (30), cx/gpt-5.6-terra-max (20), deepseek-v4-flash (15)

### `orq-premium-hard`

- **Contexto:** 1M | **Strategy:** auto
- **Descrição:** PREMIUM HARD — Raciocínio supremo & blindado. Claude Opus 4.8 + Kimi K3 1M + Gemini 3.1 Pro
- **Pool:** claude-opus-4-8 (40), kimi-k3 (25), gemini-3.1-pro (20), claude-sonnet-5 (15)

### `orq-premium-auto`

- **Contexto:** 1M | **Strategy:** auto
- **Descrição:** PREMIUM AUTO — Mix inteligente. Opus + Sonnet + Kimi K3 + Terra Max + Groq
- **Pool:** claude-opus-4-8 (25), claude-sonnet-5 (20), kimi-k3 (20), cx/gpt-5.6-terra-max (15), groq/gpt-oss-120b (10), gemini-3.5-flash (10)

---

## 📋 Resumo Rápido para Copiar

```
orq-easy          → Tarefas leves (DeepSeek/Gemini/Cursor)
orq-free-easy     → FREE tarefas leves (Groq 20B + Llama 8B)
orq-speed-128k    → SPEED 128K (Groq LPU + Kimi + DeepSeek)

orq-medium        → Dev normal (Kimi/DeepSeek/Gemini/Cursor)
orq-free-medium   → FREE dev (Groq 120B + Gemini 3.5)
orq-speed-256k    → SPEED 256K (Nemotron NVIDIA)

orq-hard          → Arquitetura (Claude Opus + Gemini Pro)
orq-free-hard     → FREE hard (Fusion Nemotron + DeepSeek judge)

orq-auto          → Pool misto (todos providers)
orq-free-auto     → FREE pool (Groq+Gemini+NVIDIA)

orq-premium-speed    → VELOCIDADE (Groq + Terra Max + Opus Fast)
orq-premium-speed-1m → VELOCIDADE 1M (Opus Fast + Gemini + Kimi + Grok)
orq-premium-medium   → DEV dia a dia (Sonnet 5 + Kimi K3 + Terra)
orq-premium-hard     → ARQUITETURA (Opus 4.8 + Kimi K3 1M + Gemini)
orq-premium-auto     → MIX premium (Opus + Sonnet + Kimi + Terra + Groq)
```
