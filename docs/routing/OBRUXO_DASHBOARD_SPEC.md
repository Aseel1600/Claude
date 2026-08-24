---
title: Obruxo Dashboard
description: Especificacao do painel autoral de roteamento do Obruxo.
---

# Obruxo Dashboard

Status: proposta para implementacao
Rota principal: `/dashboard/obruxo`
Escopo: painel autoral para administrar o BRUXO, sem substituir o painel generico de combos.

## 1. Objetivo

Criar uma pagina exclusiva para operar a camada Obruxo com a identidade visual existente do OmniRoute.
O painel deve permitir entender e alterar, em tempo real:

- modos `BRUXO`, `BRUXO-FREE` e `BRUXO-MAX`;
- tipos `coder`, `analyser`, `reviewer`, `agentic` e `tools`;
- niveis `MID`, `HIGH`, `XHIGH` e `MAX`;
- combos, modelos candidatos, ordem de fallback e estrategia;
- `levelFloors` e demais regras de classificacao;
- uso, custo, latencia, erros e fallbacks.

O painel sera uma interface para o roteador existente. Nao deve criar um segundo motor de roteamento.

## 2. Fonte de verdade

- Configuracao Obruxo: `key_value(namespace=settings, key=bruxoRouting)`.
- Combos: tabela `combos`.
- Decisoes de roteamento: `routing_observations` e `routing_decisions`.
- Execucoes reais: `call_logs` e `usage_history`.
- Precos: configuracao de pricing ja usada pelo endpoint de analytics.

O seed continua sendo ferramenta de bootstrap e recuperacao. O painel deve escrever por API, nunca diretamente na SQLite.

## 3. Experiencia da pagina

### 3.1 Visao geral

Exibir no primeiro viewport:

- status do Obruxo e timestamp da ultima sincronizacao;
- modo ativo e quantidade de combos validos;
- chamadas nas ultimas 24 horas;
- custo estimado, tokens e latencia media;
- distribuicao por tipo e nivel;
- modelos mais chamados;
- alertas de concentracao, falha, fallback e custo.

### 3.2 Matriz de roteamento

Tabela editavel com:

| Tipo     | MID   | HIGH  | XHIGH | MAX   |
| -------- | ----- | ----- | ----- | ----- |
| coder    | combo | combo | combo | combo |
| analyser | combo | combo | combo | combo |
| reviewer | combo | combo | combo | combo |
| agentic  | combo | combo | combo | combo |
| tools    | combo | combo | combo | combo |

Cada celula mostra combo, estrategia, quantidade de modelos, custo estimado e estado de saude.
`BRUXO-MAX` deve aparecer como modo explicito e permanecer separado da matriz automatica do `BRUXO`.

### 3.3 Detalhe do combo

Ao abrir uma celula, mostrar:

- modelos candidatos e provider;
- ordem de prioridade ou pesos;
- custo de entrada e saida por 1M de tokens;
- contexto anunciado;
- saude, latencia e ultima falha;
- teste individual de cada modelo;
- historico de fallbacks.

Para o `MAX`, destacar a cadeia atual `Claude Opus 5 -> Claude Opus 4.8`.

### 3.4 Politicas

Controles para:

- ativar/desativar modos de entrada;
- editar `fallbackCategory`;
- configurar `maxFallbackLevel`;
- editar `levelFloors.largeContext`, `multiTask`, `criticalRisk` e `tools`;
- revisar regras de classificacao antes de salvar;
- visualizar diferenca entre configuracao atual e nova configuracao.

Salvar deve usar revisao otimista, confirmar a alteracao e aplicar hot reload para as proximas requisicoes.

### 3.5 Analytics

Filtros: periodo, modo, tipo, nivel, combo, provider, modelo e status.

Metricas obrigatorias:

- tipos mais usados;
- niveis mais usados;
- modelos mais chamados;
- combos mais chamados;
- custo total e custo medio por 1M de tokens;
- tokens de entrada, saida e cache;
- latencia media e p95;
- taxa de sucesso e quantidade de erros;
- fallbacks por combo e modelo;
- modelo solicitado, decisao do roteador e modelo que respondeu;
- comparacao `BRUXO` x `BRUXO-FREE` x `BRUXO-MAX`.

Alertas/anomalias:

- `MID` sem uso ou subutilizado;
- `MAX` acima do limite esperado;
- modelo concentrando chamadas;
- falhas repetidas de provider;
- requisicoes simples promovidas para `XHIGH` ou `MAX`;
- aumento anormal de custo ou latencia.

## 4. Rotas existentes para reaproveitar

Todas as rotas abaixo ja exigem autenticacao de gerenciamento quando aplicavel.

### Configuracao e combos

- `GET/PATCH /api/settings`: ler e atualizar settings com persistencia, revisao e hot reload.
- `GET /api/combos`: listar combos persistidos.
- `GET/PUT /api/combos/:id`: consultar e editar um combo.
- `GET /api/combos/metrics`: metricas atuais por combo.
- `DELETE /api/combos/metrics`: reset das metricas operacionais.
- `POST /api/combos/test`: testar os modelos de um combo com chamada real.
- `GET /api/combos/auto`: consultar candidatos de combos automaticos quando necessario.

### Uso, logs e explicacao

- `GET /api/usage/analytics`: custos e uso agregados por periodo, provider e modelo.
- `GET /api/usage/call-logs`: chamadas reais, status, tokens, combo, provider, modelo e correlacao.
- `GET /api/logs/:id`: detalhes de uma chamada.
- `GET /api/routing/decisions/:requestId`: explicacao da decisao de roteamento.
- `GET /api/usage/route-explain/:id`: explicacao complementar da rota quando disponivel.
- `GET /api/usage/model-latency-stats`: latencia agregada por modelo.

### Saude e tempo real

- `GET /api/monitoring/health`: saude de providers, circuit breakers, sessoes e limites.
- `GET /api/health/ping`: health check leve.
- `GET /api/v1/ws`: handshake do WebSocket de eventos do dashboard.
- Canal WebSocket `/live`, topicos `requests`, `combo` e `credentials`.

## 5. APIs novas necessarias

As APIs abaixo sao especificas do painel e devem encapsular validacao, normalizacao e auditoria.

- `GET /api/obruxo/config`: retorna configuracao normalizada, matriz e combos relacionados.
- `PUT /api/obruxo/config`: atualiza a configuracao inteira com `expectedRevision`.
- `POST /api/obruxo/simulate`: classifica uma requisicao sem executar provider e retorna tipo, nivel, sinais e combo.
- `GET /api/obruxo/analytics`: agrega `routing_observations`, `call_logs` e `usage_history` por tipo, nivel, modelo e combo.
- `GET /api/obruxo/analytics/timeseries`: serie temporal para graficos de uso, custo, latencia e falhas.

Essas APIs devem reutilizar `normalizeBruxoRoutingConfig`, `resolveBruxoRoute`, `getSettings`, `updateSettings` e as funcoes existentes de analytics.

## 6. Frontend e identidade visual

Reutilizar o layout, autenticacao, tema, espacamento e estados do dashboard atual.

Componentes base:

- `Card`, `Button`, `Badge`, `DataTable`, `EmptyState`, `Loading`;
- `Input`, `Select`, `Toggle`, `Tooltip`, `SegmentedControl`, `FilterBar`;
- `MetricCard` existente em `dashboard/costs` quando adequado;
- padroes de tabela, modal e notificacao de `dashboard/combos`.

Referencias visuais e funcionais:

- `dashboard/settings/routing/page.tsx`;
- `dashboard/combos/page.tsx`;
- `dashboard/combos/ComboControlCenterClient.tsx`;
- `dashboard/combos/live/ComboLiveStudio.tsx`;
- `shared/components/UsageAnalytics.tsx`;
- `shared/components/RequestLoggerV2.tsx`;
- `shared/components/SystemMonitor.tsx`.

Adicionar a entrada `Obruxo` na navegacao existente, respeitando as regras de sidebar e traducoes do projeto.

## 7. Atualizacao em tempo real

- Alteracao de configuracao: `PUT /api/obruxo/config` -> `updateSettings()` -> `applyRuntimeSettings()`.
- Efeito: proxima requisicao usa a nova configuracao; requisicoes em andamento nao mudam.
- Analytics: WebSocket atualiza contadores e ultimas chamadas; polling lento serve como fallback.
- Em caso de conflito de revisao, o painel deve recarregar a configuracao e mostrar a diferenca.
- Nenhum restart ou rebuild deve ser necessario para mudar combos e regras persistidas.

## 8. Seguranca e operacao

- Reutilizar `requireManagementAuth`.
- Registrar alteracoes em audit log com autor, campos alterados e revisao.
- Nunca exibir chaves de provider.
- Validar que todos os combos referenciados existem e estao ativos.
- Impedir salvar modelo sem provider valido no catalogo ou marcar explicitamente como indisponivel.
- Exigir confirmacao para limpar metricas ou alterar `BRUXO-MAX`.
- Disponibilizar exportacao e restauracao da configuracao Obruxo.

## 9. Criterios de aceite

- A pagina `/dashboard/obruxo` abre usando a identidade visual existente.
- A matriz mostra os cinco tipos e quatro niveis atuais.
- Os combos `*-max` aparecem na matriz e no modo `BRUXO-MAX`.
- O painel distingue `BRUXO`, `BRUXO-FREE` e `BRUXO-MAX`.
- Uma simulacao mostra tipo, nivel, sinais, combo e motivo da elevacao.
- Alterar uma regra persiste e afeta a proxima requisicao sem restart.
- O painel mostra tipos, niveis, combos e modelos mais usados.
- O painel mostra custo, tokens, latencia, falhas e fallbacks.
- Um detalhe de requisicao permite chegar ao modelo real que respondeu.
- Uma falha de provider aparece como fallback, sem ser confundida com sucesso do modelo inicial.

## 10. Ordem de implementacao

1. Criar APIs de configuracao, simulacao e analytics do Obruxo.
2. Criar pagina, navegacao e visao geral.
3. Implementar matriz editavel e detalhe de combos.
4. Adicionar analytics historico e atualizacao WebSocket.
5. Adicionar auditoria, exportacao, rollback e testes de permissao.
