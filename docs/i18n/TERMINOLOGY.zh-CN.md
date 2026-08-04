# 中文翻译规范 — OmniRoute UI 汉化

本文档定义 `src/i18n/messages/zh-CN.json` 与所有面向用户 UI 文案的中文翻译规则。
由 T1 任务产出,作为 T2–T12 所有翻译/抽取工作的**强约束**。

---

## 1. 总原则(全中文化)

**规则 A:中文优先**

凡是面向终端用户的可读字符串,**优先译为中文**。仅当一条术语被明确列入
[第 4 节例外清单](#4-例外清单少量保留英文)时,才保留英文原文。

不要中英混杂。同一概念在同一文件、同一页面内,只允许**一种**译法。

## 2. 强约束术语表(不可替换)

| 英文 | 中文 | 备注 |
|---|---|---|
| `Token`(鉴权凭证) | **令牌** | 例:`auth_token` → `认证令牌` |
| `Token`(文本生成单位) | **词元** | 例:`promptTokens` → `输入词元`,`completionTokens` → `输出词元`,`totalTokens` → `总词元` |
| `Combo` | **组合** | 包含 `comboDeleted`/`comboCreated`/`addModelToCombo`/`disableCombo` 等所有派生名 |
| `Model` | **Model**(保留英文) | UI 中 Model 一律不译;整个代码库已稳定形成此惯例 |
| `Provider` | **提供者** | 不再保留 `Provider` 英文形式 |
| `Endpoint` | **端点** | 不再保留 `Endpoint` 英文形式 |
| `Connection`(凭证) | **连接** | — |
| `Proxy` | **代理** | — |
| `Wire API` | **Wire API** | 例外保留(协议名,见第 4 节) |
| `Fallback chain` | **兜底链** | — |
| `Alias`(模型别名) | **别名** | — |
| `Dashboard` | **仪表盘** | 不再保留 `Dashboard` 英文形式 |

## 3. 翻译一致性规则

### 3.1 同一术语单一译名

任何术语在**所有 88 个命名空间**里译法必须**完全一致**。
例如:`Provider` 一律 `服务商`,不得出现 `提供者`、`提供方`、`供应方`、`Provider` 等变体。

### 3.2 派生键同样约束

以 `combo`、`provider`、`token`、`endpoint` 为前缀的键,
其内部字符串须遵守第 2 节译名:
- `comboDeleted` → `组合已删除`(禁止 `Combo 已删除`)
- `audioProvidersHeading` → `音频服务商`(禁止 `音频 Provider`)
- `promptTokens` → `输入词元`(禁止 `输入 Tokens`)
- `addModelToCombo` → `添加模型到组合`(禁止 `添加模型到 Combo`)

### 3.3 短串优先中文

短按钮/标签(`Save`、`Cancel`、`Delete`、`Refresh`、`Copy` 等)翻译示例:

| 英文 | 中文 |
|---|---|
| Save | 保存 |
| Cancel | 取消 |
| Delete | 删除 |
| Refresh | 刷新 |
| Copy | 复制 |
| Copied! | 已复制 |
| Enable | 启用 |
| Disable | 禁用 |
| Submit | 提交 |
| Reset | 重置 |
| Search | 搜索 |
| Back | 返回 |
| Next | 下一步 |
| Close | 关闭 |
| Confirm | 确认 |
| Loading... | 加载中... |
| No data available | 暂无数据 |

### 3.4 中英文标点

- 中文文案使用**全角标点**:`,。?!:;` 不用 `, . ? ! : ;`
- 已有模板字符串中的 `${var}` 保留半角结构:`保存 {name} 的设置`
- 括号统一使用全角 `()`(除代码相关引用外)

### 3.5 占位符与插值

- 插值占位符 `{count}`、`{name}` 保留,不翻译
- 但占位符前后**中文文案要自然**:`共 {count} 项` 而非 `总数 {count} 项` 中的"数"叠加
- ICU 占位符语法 `{var, plural, =0 {无} one {一项} other {多项}}` 中变量名保留,文案中文化

## 4. 例外清单(少量保留英文 / 既有约定)

以下**协议、产品、技术名称**在中文译名易混淆时保留英文:

| 名称 | 类别 | 为何例外 |
|---|---|---|
| OAuth | 协议 | 行业通用缩写,翻译易混淆 |
| MCP | 协议/产品 | Model Context Protocol 通用缩写 |
| A2A | 协议 | Agent-to-Agent 通用缩写 |
| JWT | 技术 | JSON Web Token 通用缩写 |
| SSE | 协议 | Server-Sent Events 通用缩写 |
| WebSocket | 协议 | 通用技术名词 |
| Hex | 进制 | 与"十六进制"等译法歧义大 |
| Wire API | 协议 | OpenAI/Anthropic 协议名,翻译后不可识别 |
| OpenAI / Claude / Gemini / Qwen / Kimi 等 | 产品名 | 厂商产品名,不翻译 |
| Anthropic / OpenAI / Google / ByteDance 等 | 公司名 | 不翻译 |
| ID | 缩写 | 保留 `ID` |
| API | 缩写 | 保留 `API` |
| URL / URI / HTTP / HTTPS | 协议/格式 | 不翻译 |
| JSON / YAML / CSV / SQL | 格式 | 不翻译 |
| GitHub / GitLab / npm / Node | 工具/平台 | 不翻译 |

### 4.1 既有约定例外(已稳定运行的子项目)

| 场景 | 例外 | 理由 |
|---|---|---|
| **`bin/cli/locales/zh-CN.json`** | `Provider` 一律译为 `提供者`(不译为 `服务商`) | 该文件已有 60+ 处"提供者"批翻译,改动会引入大量回归;新增内容须沿用 `提供者` |

**说明**:本例外仅限 `bin/cli/locales/zh-CN.json`,与 `src/i18n/messages/zh-CN.json` 一致地译为「提供者」。`src/i18n/messages/zh-CN.json` 及新抽取的硬编码 UI 文案均按本规范执行 `Provider → 提供者`。

## 5. 禁止事项

- ❌ `Combo 已删除` → 应为 `组合已删除`
- ❌ `音频 Provider` → 应为 `音频服务商`
- ❌ `输入 Tokens` → 应为 `输入词元`
- ❌ `未知 Provider` → 应为 `未知服务商`
- ❌ `访问 Dashboard` → 应为 `访问仪表盘`
- ❌ `Endpoint 已配置` → 应为 `端点已配置`
- ❌ 同一页面出现 `Token` 与 `令牌` 两种译法(锁冲突)
- ❌ 同一页面出现 `Provider` 与 `服务商` 两种译法(锁冲突)

## 6. 适用范围

本规范适用于:

1. `src/i18n/messages/zh-CN.json` 所有 88 个命名空间
2. `bin/cli/locales/zh-CN.json` CLI 客户端文案
3. 所有 React 组件 JSX 中**新抽取的硬编码 UI 文案**

本规范**不适用**于:

- `open-sse/`、`@omniroute/`、`bin/` 源码注释
- `electron/` 应用内部 UI
- `docs/` 文档(独立翻译项目)
- `tokenExtractionConfig.ts` 中的 `instructions` 开发者配置
- Provider ID、Cookie 名、URL 路径等**机器可读常量**

## 7. 校验

T11 任务将依据本规范做最终校验。失败示例:

- 翻译后仍有未翻译的英文短语(除例外清单外)
- 同一术语多种中文译法并存
- 中英标点混用

---

**维护**:本规范由 T1 创建。术语表新增条目须在 PR 中显式声明;例外清单新增须说明理由。