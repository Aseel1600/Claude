# Modelos NVIDIA NIM — Separados por Tamanho de Contexto

> **Data:** 2026-08-21
> **Fonte:** catálogo público `https://integrate.api.nvidia.com/v1/models` (102 modelos)
> **Filtrados:** apenas chat/code utilizáveis em combos (excluídos embeddings, rerank, imagem, áudio)
> **Nota:** O `/v1/models` da NVIDIA NÃO retorna `context_length`. Os valores abaixo vêm da
> documentação oficial de cada modelo/família. Confirmar na UI antes de usar em produção crítica.

---

## Resumo por Faixa

| Faixa de Contexto  | Qtd    | Melhor uso                                         |
| ------------------ | ------ | -------------------------------------------------- |
| **256K** (262.144) | 8      | Tarefas grandes, análise de código extensa         |
| **250K** (256.000) | 1      | Jamba (SSM híbrido, contexto longo)                |
| **128K** (131.072) | 35     | Uso geral, dev normal, a maioria dos LLMs modernos |
| **64K** (65.536)   | 1      | Mixtral 8x22B                                      |
| **32K** (32.768)   | 7      | Modelos de código, LLMs antigos                    |
| **16K** (16.384)   | 2      | Coders pequenos                                    |
| **≤ 8K**           | vários | Modelos legados/pequenos                           |

---

## 🟢 256K — Contexto Grande (262.144 tokens)

Ideal para **tarefas pesadas**: análise de repositórios, revisão profunda, contexto extenso.

| Modelo                               | Prefixo no Gateway                                     | Tamanho      |
| ------------------------------------ | ------------------------------------------------------ | ------------ |
| Nemotron 3 Ultra 550B                | `nvidia/nvidia/nemotron-3-ultra-550b-a55b`             | 550B MoE     |
| Nemotron 3 Super 120B                | `nvidia/nvidia/nemotron-3-super-120b-a12b`             | 120B MoE     |
| Nemotron 3.5 Lightning 30B           | `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b`         | 30B MoE      |
| Nemotron Nano 3 30B                  | `nvidia/nvidia/nemotron-nano-3-30b-a3b`                | 30B          |
| Nemotron 3 Nano 30B                  | `nvidia/nvidia/nemotron-3-nano-30b-a3b`                | 30B          |
| Nemotron 3 Nano Omni 30B (reasoning) | `nvidia/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | 30B          |
| Nemotron Nano 12B VL                 | `nvidia/nvidia/nemotron-nano-12b-v2-vl`                | 12B (vision) |

> 🏆 **Destaques:** `nemotron-3-super-120b-a12b` e `nemotron-3-ultra-550b-a55b` — os mais fortes
> da NVIDIA, com raciocínio e contexto grande, gratuitos no tier free.

---

## 🟢 250K — Jamba (256.000 tokens)

| Modelo          | Prefixo no Gateway                         | Arquitetura                     |
| --------------- | ------------------------------------------ | ------------------------------- |
| Jamba 1.5 Large | `nvidia/ai21labs/jamba-1.5-large-instruct` | SSM híbrido (Mamba+Transformer) |

> Jamba usa arquitetura híbrida eficiente para contextos longos.

---

## 🔵 128K — Contexto Padrão (131.072 tokens)

A **maior faixa** — cobre a maioria dos LLMs modernos. Ideal para **dev normal e uso geral**.

### LLMs de propósito geral (top picks)

| Modelo                            | Prefixo no Gateway                                | Tamanho |
| --------------------------------- | ------------------------------------------------- | ------- |
| 🏆 Llama 3.3 70B                  | `nvidia/meta/llama-3.3-70b-instruct`              | 70B     |
| 🏆 Llama 3.1 Nemotron 70B         | `nvidia/nvidia/llama-3.1-nemotron-70b-instruct`   | 70B     |
| 🏆 Llama 3.1 Nemotron Ultra 253B  | `nvidia/nvidia/llama-3.1-nemotron-ultra-253b-v1`  | 253B    |
| Llama 3.3 Nemotron Super 49B v1.5 | `nvidia/nvidia/llama-3.3-nemotron-super-49b-v1.5` | 49B     |
| Llama 3.1 70B                     | `nvidia/meta/llama-3.1-70b-instruct`              | 70B     |
| Mistral Large 2                   | `nvidia/mistralai/mistral-large-2-instruct`       | 123B    |
| Mistral Nemotron                  | `nvidia/mistralai/mistral-nemotron`               | —       |
| GPT-OSS 120B                      | `nvidia/openai/gpt-oss-120b`                      | 120B    |
| GPT-OSS 20B                       | `nvidia/openai/gpt-oss-20b`                       | 20B     |
| Kimi K3                           | `nvidia/moonshotai/kimi-k3`                       | —       |
| Kimi K2.6                         | `nvidia/moonshotai/kimi-k2.6`                     | —       |
| DeepSeek V4 Flash                 | `nvidia/deepseek-ai/deepseek-v4-flash-0731`       | Flash   |
| Gemma 4 31B                       | `nvidia/google/gemma-4-31b-it`                    | 31B     |
| Phi 3.5 MoE                       | `nvidia/microsoft/phi-3.5-moe-instruct`           | MoE     |

### LLMs menores / rápidos (128K)

| Modelo           | Prefixo no Gateway                              |
| ---------------- | ----------------------------------------------- |
| Llama 3.1 8B     | `nvidia/meta/llama-3.1-8b-instruct`             |
| Llama 3.2 3B     | `nvidia/meta/llama-3.2-3b-instruct`             |
| Llama 3.2 1B     | `nvidia/meta/llama-3.2-1b-instruct`             |
| Gemma 3 12B      | `nvidia/google/gemma-3-12b-it`                  |
| Gemma 3 4B       | `nvidia/google/gemma-3-4b-it`                   |
| Granite 3.0 8B   | `nvidia/ibm/granite-3.0-8b-instruct`            |
| Granite 3.0 3B   | `nvidia/ibm/granite-3.0-3b-a800m-instruct`      |
| Mistral Nemo 12B | `nvidia/nv-mistralai/mistral-nemo-12b-instruct` |
| Nemotron 51B     | `nvidia/nvidia/llama-3.1-nemotron-51b-instruct` |
| Nemotron Nano 8B | `nvidia/nvidia/llama-3.1-nemotron-nano-8b-v1`   |

### Código (128K)

| Modelo           | Prefixo no Gateway                             |
| ---------------- | ---------------------------------------------- |
| Codestral 22B    | `nvidia/mistralai/codestral-22b-instruct-v0.1` |
| Granite 34B Code | `nvidia/ibm/granite-34b-code-instruct`         |

### Vision (128K)

| Modelo               | Prefixo no Gateway                               |
| -------------------- | ------------------------------------------------ |
| Llama 3.2 90B Vision | `nvidia/meta/llama-3.2-90b-vision-instruct`      |
| Llama 3.2 11B Vision | `nvidia/meta/llama-3.2-11b-vision-instruct`      |
| Nemotron Nano VL 8B  | `nvidia/nvidia/llama-3.1-nemotron-nano-vl-8b-v1` |

---

## 🟡 64K — Mixtral (65.536 tokens)

| Modelo        | Prefixo no Gateway                    |
| ------------- | ------------------------------------- |
| Mixtral 8x22B | `nvidia/mistralai/mixtral-8x22b-v0.1` |

---

## 🟠 32K — Contexto Médio (32.768 tokens)

Modelos mais antigos ou focados em código.

| Modelo           | Prefixo no Gateway                          | Tipo   |
| ---------------- | ------------------------------------------- | ------ |
| DBRX Instruct    | `nvidia/databricks/dbrx-instruct`           | LLM    |
| Yi Large         | `nvidia/01-ai/yi-large`                     | LLM    |
| CodeLlama 70B    | `nvidia/meta/codellama-70b`                 | Código |
| Starcoder2 15B   | `nvidia/bigcode/starcoder2-15b`             | Código |
| CodeGemma 7B     | `nvidia/google/codegemma-7b`                | Código |
| CodeGemma 1.1 7B | `nvidia/google/codegemma-1.1-7b`            | Código |
| Mistral 7B v0.3  | `nvidia/mistralai/mistral-7b-instruct-v0.3` | LLM    |

---

## 🔴 16K e ≤ 8K — Contexto Pequeno

Modelos legados/pequenos — evitar em combos principais.

| Modelo              | Prefixo no Gateway                                | Contexto |
| ------------------- | ------------------------------------------------- | -------- |
| DeepSeek Coder 6.7B | `nvidia/deepseek-ai/deepseek-coder-6.7b-instruct` | 16K      |
| Granite 8B Code     | `nvidia/ibm/granite-8b-code-instruct`             | 16K      |
| Gemma 2B            | `nvidia/google/gemma-2b`                          | 8K       |
| RecurrentGemma 2B   | `nvidia/google/recurrentgemma-2b`                 | 8K       |
| Nemotron 4 340B     | `nvidia/nvidia/nemotron-4-340b-instruct`          | 4K       |
| Nemotron Mini 4B    | `nvidia/nvidia/nemotron-mini-4b-instruct`         | 4K       |

---

## 💡 Recomendação para os Combos `orq-*`

Alinhando com a arquitetura atual (contexto unificado 1M, pre-filter automático):

| Combo        | Modelos NVIDIA sugeridos                                          | Faixa                  |
| ------------ | ----------------------------------------------------------------- | ---------------------- |
| `orq-easy`   | `llama-3.2-3b`, `gemma-3-4b`, `granite-3.0-8b`                    | 128K (rápidos/baratos) |
| `orq-medium` | `llama-3.3-70b`, `codestral-22b`, `gpt-oss-20b`                   | 128K (dev normal)      |
| `orq-hard`   | `nemotron-3-super-120b`, `nemotron-ultra-253b`, `mistral-large-2` | 256K/128K (raciocínio) |
| `orq-auto`   | mix dos acima                                                     | variado                |

> ⚠️ **Antes de usar:** confirmar que os modelos estão **sincronizados no gateway** (`/v1/models`).
> Hoje só ~13-24 estão sincronizados dos 51 gratuitos. Os demais precisam ser importados na UI.

---

## Verificação Rápida (quais estão sincronizados no gateway)

```bash
curl -s http://localhost:20131/v1/models \
  -H "Authorization: Bearer <API_KEY>" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      const m=(JSON.parse(d).data||[]).map(x=>x.id).filter(x=>x.startsWith('nvidia/'));
      console.log(m.length+' modelos NVIDIA no gateway:'); m.forEach(x=>console.log(' ',x));
    })"
```
