# Provider 可插拔扩展设计

**日期**：2026-09-18
**作者**：Claude（brainstorming 协作）
**状态**：草案，待用户 review

---

## 目标

把 sidepad 的 LLM provider 体系从"4 个并列类 + factory switch"重构为"**协议基类 + 厂商子类 + per-model 参数覆盖**"的分层架构，使：

1. **新增协议 / 厂商 / 模型** 不需要改既有类（开闭原则）
2. **每个厂商独立文件**（low coupling）— 出问题定位到文件即可
3. **继承 + 重载**（OOP 自然）— 厂商子类可 override 基类方法
4. **per-model 参数差异** 通过 DB JSON 覆盖，无需改协议实现
5. **现有用户数据** 无破坏 — 向后兼容现有 `params_json` 结构

## 三个新增能力（spec 范围）

1. **`extraHeaders` + `extraBody` 通用参数透传**
2. **`anthropic-messages` provider** — 通用 Anthropic Messages 协议 + 自定义 baseURL（接 Bedrock / Vertex / Minimax 等任何暴露该协议的厂商）
3. **Gemini 原生 provider** — 用 `@google/genai` SDK 接 Gemini（多模态 / 缓存 / thinkingConfig 全量）

## 架构分层

```
src/main/providers/
  base/                          # 协议基类层（不可改的协议骨架）
    base-provider.ts             # 抽象基类：SDK 构造、stream→chunk、override 合并
    anthropic-base.ts            # Anthropic Messages 协议
    openai-base.ts               # OpenAI Chat Completions 协议
    gemini-base.ts               # Gemini generateContent 协议
    oai-compat-base.ts           # OpenAI 兼容协议
  anthropic.ts                   # 直连 = 协议基类默认实现（保持现有 4 个 type 不变）
  openai.ts                      # 直连
  openai-compat.ts               # 通用 OAI 兼容
  ollama.ts                      # 本地
  anthropic-messages.ts          # 🆕 通用 Anthropic Messages + baseURL（SDK 原生支持）
  gemini.ts                      # 🆕 Gemini 原生（@google/genai）
  vendors/                       # 🆕 厂商扩展层（extends 对应 *-base）
    anthropic-bedrock.ts         # 例：未来加 — extends anthropic-base，加 SigV4
    anthropic-vertex.ts          # 例：未来加 — extends anthropic-base，加 GCP token
    anthropic-minimax.ts         # 例：未来加 — extends anthropic-base，改 baseURL + 私有 header
    gemini-vertex.ts             # 例：未来加 — extends gemini-base
  overrides.ts                   # 🆕 params_json → 运行时 override 解析（per-model）
  factory.ts                     # 协议+厂商注册 + per-model overrides 注入
```

**关键约定**：
- 顶层文件（`anthropic.ts` 等） = 协议直连默认实现，type 直接用其类名
- `base/` 内协议基类 = 不可直接注册到 factory，仅供子类继承
- `vendors/` 内厂商子类 = 平铺 type 枚举（`anthropic-bedrock`），必须 extends 对应 `-base`
- `factory.ts` 按 `row.type` 选类，构造时传入 `parsedParams`（含 extraHeaders/extraBody/modelOverrides）
- 子类重载约定：必须先 `super.applyOverrides()` 再修改字段，不破坏基类行为

## 数据模型 — `params_json` schema

不新增列，复用现有 `params_json: string | null`：

```ts
interface ProviderParams {
  defaultModel?: string;
  extraHeaders?: Record<string, string>;         // 透传给 SDK 请求头
  extraBody?: Record<string, unknown>;          // 透传给 SDK 请求体
  modelOverrides?: Record<string, ModelOverride>; // key = model id
}

interface ModelOverride {
  // 通用
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  toolChoice?: string;
  // 厂商私有
  thinkingBudget?: number;                      // Gemini thinkingConfig / Anthropic budget_tokens
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  safetySettings?: unknown;                     // Gemini 专用
  extraHeaders?: Record<string, string>;        // per-model 头部覆盖
  extraBody?: Record<string, unknown>;          // per-model body 覆盖
}
```

**向后兼容**：现有只含 `{defaultModel}` 的 JSON 不需迁移；新字段都是 optional。

## Provider Type 枚举

| Type | 类 | 协议 | baseURL 必填 | 用途 |
|---|---|---|---|---|
| `openai` | `OpenAIProvider` | OpenAI Chat Completions | 否 | OpenAI 直连 |
| `anthropic` | `AnthropicProvider` | Anthropic Messages | 否 | Anthropic 直连 |
| `ollama` | `OllamaProvider` | Ollama 原生 | 是（默认 `http://localhost:11434`） | 本地 Ollama |
| `openai-compat` | `OpenAICompatProvider` | OpenAI Chat Completions | 是 | 通用 OAI 兼容 |
| `anthropic-messages` 🆕 | `AnthropicMessagesProvider` | Anthropic Messages | 是 | 通用 Anthropic Messages 兼容厂商 |
| `gemini` 🆕 | `GeminiProvider` | Gemini generateContent | 否 | Gemini 直连 |

未来扩展（不在本 spec 范围，但留好接口）：`anthropic-bedrock` / `anthropic-vertex` / `anthropic-minimax` / `gemini-vertex` — 通过 `vendors/` 子类 + 平铺 type 实现。

## 协议基类 — 公共方法契约

`base/base-provider.ts` 提供：

```ts
abstract class BaseProvider implements LLMProvider {
  abstract listModels(): Promise<Model[]>;
  abstract chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk>;
  
  /** 给子类用：合并 provider 级与 per-model overrides */
  protected applyOverrides(
    model: string,
    baseHeaders: Record<string, string>,
    baseBody: Record<string, unknown>,
  ): { headers: Record<string, string>; body: Record<string, unknown> };
  
  /** 给子类用：把 ChatRequest.reasoningEffort 翻译成厂商原生字段 */
  protected translateReasoning(
    req: ChatRequest,
    capabilities: ProviderCapabilities,
  ): Record<string, unknown> | null;  // 注入 body 的字段
}
```

**Override 合并顺序**（低 → 高优先级）：
1. 基类默认值（如 `temperature: undefined`）
2. `extraHeaders` / `extraBody`（provider 级配置）
3. `modelOverrides[req.model]`（per-model 配置）
4. `ChatRequest` 实时字段（`req.temperature` 等）

后写覆盖前写，undefined 字段不覆盖已有值。

## UI 改动 — ProviderForm.tsx

**type 下拉新增 2 项**：`anthropic-messages`、`gemini`

**新增折叠区 "Advanced"**（所有 type 都可见）：
- **Extra Headers**：key/value 表格行（trash 图标删除）+ "Add header" 按钮
- **Extra Body**：多行 textarea，placeholder `{"key": "value"}`，blur 时 JSON.parse 校验（失败显示红色 hint）

**type-specific 字段**：
- `anthropic-messages`：baseURL 必填，apiKey 必填，label 提示"Any Anthropic Messages compatible endpoint"
- `gemini`：apiKey 必填，baseURL 可选（Vertex AI 端点），label 提示"Google AI Studio or Vertex"

## 关键变更点（详细）

### 1. `factory.ts` 改写

```ts
type ProviderConstructor = (id, configId, apiKey, baseURL, parsedParams) => LLMProvider;

const REGISTRY: Record<string, ProviderConstructor> = {
  'openai': (id, cid, k, b, p) => new OpenAIProvider(id, cid, k, b, p),
  'anthropic': (id, cid, k, b, p) => new AnthropicProvider(id, cid, k, p),
  'ollama': (id, cid, k, b, p) => new OllamaProvider(id, cid, b),
  'openai-compat': (id, cid, k, b, p) => b ? new OpenAICompatProvider(id, cid, k, b, p) : null,
  'anthropic-messages': (id, cid, k, b, p) => b ? new AnthropicMessagesProvider(id, cid, k, b, p) : null,
  'gemini': (id, cid, k, b, p) => new GeminiProvider(id, cid, k, b, p),
};
```

### 2. `overrides.ts`

```ts
export function parseProviderParams(json: string | null): ProviderParams {
  if (!json) return {};
  try { return JSON.parse(json); }
  catch { return {}; }  // 容错：损坏的 JSON 视为空对象
}

export function mergeOverrides(
  req: ChatRequest,
  providerParams: ProviderParams,
): { headers: Record<string, string>; body: Record<string, unknown> } {
  const mo = providerParams.modelOverrides?.[req.model] ?? {};
  return {
    headers: { ...providerParams.extraHeaders, ...mo.extraHeaders },
    body: {
      ...providerParams.extraBody,
      ...mo,
      // ChatRequest 实时字段最高优先级
      ...(req.temperature !== undefined && { temperature: req.temperature }),
      ...(req.maxTokens !== undefined && { max_tokens: req.maxTokens }),
    },
  };
}
```

### 3. `provider-router.ts`

`configure` mutation 的 zod schema 扩展：

```ts
input: z.object({
  id: z.string(),
  type: z.enum(['openai','anthropic','ollama','openai-compat','anthropic-messages','gemini']),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  defaultModel: z.string().optional(),
  extraHeaders: z.record(z.string(), z.string()).optional(),
  extraBody: z.record(z.string(), z.unknown()).optional(),
  modelOverrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
})
```

`listModels` / `testModel` 同样扩展 enum。

### 4. `settings-store.ts`

`addProvider` action 透传新字段。

### 5. `ProviderForm.tsx`

新增折叠区 + type-specific 字段。

## 依赖

- 新增：`@google/genai`（约 5MB）— Gemini 原生 SDK
- 现有 `@anthropic-ai/sdk` 0.91+ 已支持 `baseURL` 参数 — `anthropic-messages` 零新依赖

## 测试策略

**单元测试**（vitest）：
- `overrides.test.ts` — 合并顺序、undefined 不覆盖、损坏 JSON 容错
- `anthropic-messages.test.ts` — baseURL 透传、listModels 调用、SDK options 正确
- `gemini.test.ts` — listModels、chat 流式、thinkingBudget 翻译、multimodal（mock SDK）
- 现有 4 个 provider 回归测试：构造签名变化需更新

**集成测试**：
- `ProviderForm` UI 提交 → `provider.configure` → `factory.loadProviders` 端到端
- 真实 API 调用（仅在 manual CI 用真 key，常规 mock）

**回归**：
- 现有 provider（openai/anthropic/ollama/openai-compat）行为不变
- 现有 `params_json` 含 `{defaultModel}` 不受影响

## 风险 & 缓解

| 风险 | 缓解 |
|---|---|
| `@google/genai` SDK API 可能演进 | 用稳定子集（generateContentStream、chatStream）；锁版本 |
| `@anthropic-ai/sdk` baseURL 默认拼接 `/v1/messages` 不一定符合所有厂商 | 文档明示用户填到 host 根（不含 `/v1`），或在 baseURL 后拼接处理 |
| 现有 provider 构造签名改变导致破坏 | 5 个 provider 构造函数都加 `parsedParams?: ProviderParams` 可选参数，默认 `{}` |
| `extraBody` 误传敏感字段 | UI 显示提示；DB 写入不做 schema 校验（用户责任） |
| `modelOverrides` 键名漂移（`thinkingBudget` vs `thinking_budget`） | 文档 + JSDoc 注释每个字段映射；CapsHeuristics 集中翻译 |

## 实施顺序（本 spec 内）

按用户决策"串行：一次性 spec + plan"，3 个新增能力分 3 phase 实施：

**Phase 1 — extraHeaders/extraBody 通用参数透传**
- `overrides.ts` 新建
- 4 个现有 provider 类（OpenAI/Anthropic/Ollama/OpenAICompat）构造函数加可选 `parsedParams`
- provider-router configure schema 扩展
- settings-store 透传
- ProviderForm Advanced 折叠区
- 单元测试

**Phase 2 — anthropic-messages provider**
- `base/anthropic-base.ts` 提取（重构 anthropic.ts）
- `anthropic-messages.ts` 新建
- factory 加 case
- provider-router enum 扩展
- ProviderForm type 选项 + 必填 baseURL
- 单元测试

**Phase 3 — Gemini 原生 provider**
- 装 `@google/genai`
- `base/gemini-base.ts` 新建
- `gemini.ts` 新建
- factory 加 case
- provider-router enum 扩展
- ProviderForm type 选项
- thinkingConfig 翻译
- 单元测试

**Phase 4（可选）— 文档**
- README 新章节"添加新 provider"
- 注释 `vendors/` 目录契约（JSDoc）
- examples：未来加 `anthropic-minimax` 子类的样板

## 不在本 spec 范围

- Bedrock / Vertex / Minimax 实际子类实现（留接口，本轮不实现）
- 测试覆盖率工具升级
- Stream 性能优化
- 成本 / 限流面板