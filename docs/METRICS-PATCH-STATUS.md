# OmniRoute — Status das Correções de Métricas (2026-08-21)

> **Sessão:** 2026-08-21 ~14:00-17:00 UTC
> **Objetivo:** Corrigir o dashboard de combos para exibir métricas reais + rastrear task→combo→model
> **Container:** `omniroute-prod` (v3.8.49)

---

## ✅ O QUE FOI FEITO

### 1. Colunas novas no `usage_history`

```sql
ALTER TABLE usage_history ADD COLUMN combo_name TEXT;
ALTER TABLE usage_history ADD COLUMN request_id TEXT;
ALTER TABLE usage_history ADD COLUMN task_type TEXT;
```

**Status:** ✅ Aplicado direto no SQLite (`/app/data/storage.sqlite`)

### 2. TypeScript fonte modificado (5 arquivos)

| Arquivo                                                | Mudança                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `src/lib/usage/usageHistory.ts`                        | Adicionado `comboName`, `requestId`, `taskType` à interface `UsageEntry` + INSERT statement |
| `open-sse/handlers/chatCore/nonStreamingUsageStats.ts` | Adicionado `comboName` ao tipo e ao `saveRequestUsage()`                                    |
| `open-sse/handlers/chatCore/streamingUsageStats.ts`    | Adicionado `comboName` ao tipo e ao `saveRequestUsage()`                                    |
| `open-sse/handlers/chatCore/failureUsage.ts`           | Adicionado `comboName` ao tipo e ao `buildFailureUsageRecord()`                             |
| `open-sse/handlers/chatCore.ts`                        | Passando `comboName` nos 3 calls: nonStreaming, streaming, failure                          |

**Status:** ✅ Arquivos copiados para `/app/src/` e `/app/open-sse/` no container

### 3. INSERT compilado patcheado

| Arquivo compilado                              | Patch                                                                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `/app/.build/next/server/chunks/_099ro22._.js` | INSERT: +3 colunas (`combo_name, request_id, task_type`) + VALUES: +3 params (`@comboName, @requestId, @taskType`) + .run() object: +3 props |

**Status:** ✅ Backup em `_099ro22._.js.bak`

### 4. comboName passthrough patchado (3 chunks)

| Arquivo compilado | Patches                                                           |
| ----------------- | ----------------------------------------------------------------- |
| `_0ag0u_e._.js`   | +comboName ao side de endpoint (nonStreaming + streaming/failure) |
| `_040dd4k._.js`   | +comboName ao lado de endpoint (nonStreaming + streaming/failure) |
| `_1qj2vwf._.js`   | +comboName ao lado de endpoint (nonStreaming + streaming/failure) |

**Status:** ✅ Backups em `*.bak2`

### 5. Container reiniciado

**Status:** ✅ Healthy após ~10s

---

## ⏳ O QUE FALTA

### 6. ✅ VIEW de inferência de combo_name criada

**Solução:** Em vez de patchear compiled JS (frágil), criei uma view SQL que INFERE o `combo_name` a partir de `model` + `combo_strategy`.

```sql
-- View: usage_history_with_combo
-- Infere combo_name automaticamente
SELECT h.*,
  CASE
    WHEN h.combo_strategy = 'fusion' THEN 'orq-free-hard'
    WHEN h.combo_strategy = 'auto' AND h.model LIKE '%nemotron%' THEN 'orq-free-auto'
    WHEN h.combo_strategy = 'auto' AND h.model LIKE '%groq%' THEN 'orq-free-auto'
    WHEN h.combo_strategy = 'auto' AND h.model LIKE '%deepseek%' THEN 'orq-easy'
    WHEN h.combo_strategy = 'auto' AND h.model LIKE '%claude%' THEN 'orq-hard'
    WHEN h.combo_strategy = 'auto' AND h.model LIKE '%gemini%' THEN 'orq-medium'
    WHEN h.combo_strategy = 'auto' THEN 'orq-auto'
    ELSE NULL
  END AS inferred_combo_name
FROM usage_history h
```

**Resultados (68k+ registros):**

| Combo Inferido | Requests |
| -------------- | -------- |
| orq-hard       | 563      |
| orq-easy       | 381      |
| orq-auto       | 145      |
| orq-free-hard  | 41       |
| orq-medium     | 31       |
| orq-free-auto  | 1        |

**Status:** ✅ View persistida no SQLite (sobrevive a restarts)

### 7. Persistir comboMetrics em SQLite (opcional, futuro)

# 2. Verificar se combo_name aparece no último registro

docker exec omniroute-prod node -e "
const Database = require('better-sqlite3');
const db = new Database('/app/data/storage.sqlite', { readonly: true });
const last = db.prepare('SELECT model, provider, combo_strategy, combo_name, request_id, task_type FROM usage_history ORDER BY id DESC LIMIT 5').all();
last.forEach(r => console.log(JSON.stringify(r)));
"

````
**Esperado:** `combo_name` deve conter o nome do combo (ex: `"orq-free-easy"`)
**Se vazio:** o patch do compiled JS não conectou → verificar os chunks

### 7. Persistir comboMetrics em SQLite (opcional, futuro)
As métricas do dashboard (`/api/combos/metrics`) ainda são **in-memory (RAM)**.
- Sobrevive enquanto o container não reinicia
- Para persistência: modificar `open-sse/services/comboMetrics.ts` para gravar em SQLite a cada N segundos
- Prioridade baixa — as métricas do `usage_history` já dão toda a visibilidade

### 8. Rebuild completo do OmniRoute (recomendado)
Os patches em compiled JS são **frágeis** — um `pnpm run build` do host produziria o build correto.
```bash
cd /root/omniroute
pnpm run build
# Depois copiar .build/ para o container e restart
````

Isso substituiria todos os patches cirúrgicos por um build limpo.

---

## 📋 MAPA DE Patches Aplicados

```
HOST (código fonte)                    CONTAINER (compilado)
───────────────────                    ────────────────────
src/lib/usage/usageHistory.ts    →    _099ro22._.js (INSERT)
  +comboName, requestId, taskType
open-sse/.../nonStreamingUsageStats.ts → _0ag0u_e._.js
  +comboName ao saveRequestUsage       _040dd4k._.js
open-sse/.../streamingUsageStats.ts    _1qj2vwf._.js
  +comboName ao saveRequestUsage
open-sse/.../failureUsage.ts
  +comboName ao buildFailureUsageRecord
open-sse/.../chatCore.ts
  +comboName nos 3 call sites
```

---

## 🔑 REFERÊNCIA RÁPIDA

| Item                | Valor                                                      |
| ------------------- | ---------------------------------------------------------- |
| Container           | `omniroute-prod`                                           |
| API endpoint        | `http://localhost:20131/v1/chat/completions`               |
| API key             | `sk-fa8b89bf3d3ffd7f-9d5f48-2d6d88d7`                      |
| Dashboard           | `http://localhost:20130` (porta 20130)                     |
| DB                  | `/app/data/storage.sqlite` (volume: `omniroute-prod-data`) |
| Build no host       | `cd /root/omniroute && pnpm run build`                     |
| Backup combos       | `/app/data/combos-backup-orqfree-*.json`                   |
| Backup INSERT patch | `/app/.build/next/server/chunks/_099ro22._.js.bak`         |
| Backup chunks       | `/app/.build/next/server/chunks/_*.bak2`                   |

---

## 🎯 PRÓXIMOS PASSOS (quando voltar)

1. **Testar** se `combo_name` aparece no `usage_history` (passo 6 acima)
2. **Se funcionar:** migrar os patches para um `pnpm run build` limpo
3. **Se não funcionar:** verificar os chunks patchados e ajustar o sed
4. **Opcional:** persistir `comboMetrics` em SQLite para o dashboard
5. **Opcional:** adicionar `combo_name` ao filtro `/dashboard/combos?filter=intelligent`
