# Provider 可插拔扩展 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 LLM provider 体系为"协议基类 + 厂商子类 + per-model 参数覆盖"分层架构，新增 `extraHeaders/extraBody` 透传、`anthropic-messages` provider、Gemini 原生 provider。

**Architecture:**
- 协议基类（`base/`）= 不可改的协议骨架；顶层 `anthropic.ts`/`openai.ts`/etc. = 默认厂商实现（直连）；`vendors/` = 厂商子类扩展
- `overrides.ts` = `params_json` → `{extraHeaders, extraBody, modelOverrides}` 解析 + 合并
- `factory.ts` 按 `row.type` 选类，构造时传 `parsedParams`
- 子类重载约定：先 `super.applyOverrides()` 再改字段

**Tech Stack:** TypeScript、@anthropic-ai/sdk 0.91+（已有）、@google/genai（新增）、OpenAI SDK 6.34+（已有）、vitest 4.1.5、trpc 11（现有）

**Spec:** `docs/superpowers/specs/2026-09-18-provider-extensibility-design.md`

---

## Global Constraints

- 既有 `params_json` schema 已有 `{defaultModel?}` 字段 — 新增 `extraHeaders?` `extraBody?` `modelOverrides?` 必须 **optional**，向后兼容
- Provider 构造函数新增 `parsedParams?: ProviderParams` 参数，默认 `{}`，不影响既有 4 个 provider 的所有调用方
- 工厂解析 `params_json` 失败（损坏 JSON）必须返回 `{}` 而非抛错 — 容错
- 所有新增 IPC zod 字段 **optional**，`configure` 输入向后兼容既有调用
- Provider type enum：`'openai'|'anthropic'|'ollama'|'openai-compat'|'anthropic-messages'|'gemini'`
- 测试：vitest，unit 测试 `tests/unit/`，integration 测试 `tests/integration/`
- 既有 provider 行为 **不变**（回归保护）：构造签名变化用可选参数
- commit 粒度：每 task 完成后独立 commit

---

## File Structure（新增/修改清单）

### 新增文件

```
src/main/providers/
  base/
    base-provider.ts        # 抽象基类 + applyOverrides / translateReasoning 公共方法
    anthropic-base.ts       # Anthropic Messages 协议基类（从 anthropic.ts 抽）
  overrides.ts              # parseProviderParams + mergeOverrides
  anthropic-messages.ts     # 通用 Anthropic Messages 兼容 provider
  gemini.ts                 # Gemini 原生 provider
  vendors/
    .gitkeep                # 留空目录，附 JSDoc 注释说明扩展约定

tests/unit/providers/
  overrides.test.ts
  anthropic-messages.test.ts
  gemini.test.ts

tests/integration/
  provider-config-flow.test.ts   # ProviderForm → configure → factory → provider 端到端
```

### 修改文件

```
src/main/providers/anthropic.ts          # 改 extends anthropic-base.ts；构造接 parsedParams
src/main/providers/openai.ts             # 构造接 parsedParams（仅签名变化）
src/main/providers/openai-compat.ts      # 构造接 parsedParams
src/main/providers/ollama.ts             # 构造接 parsedParams
src/main/providers/factory.ts            # 解析 params_json；switch 加 2 个 case
src/main/ipc/routers/provider-router.ts  # configure/listModels/testModel 的 zod enum + 字段扩展
src/renderer/stores/settings-store.ts    # addProvider 透传新字段
src/renderer/components/ProviderForm.tsx # Advanced 折叠区 + type 下拉加 2 项
```

### Schema（无需迁移）

`provider_configs.params_json` 列已存在，复用即可 — 无 ALTER TABLE。

---

## Phase 1 — extraHeaders/extraBody 通用参数透传

### Task 1.1: 创建 `overrides.ts`

**Files:**
- Create: `src/main/providers/overrides.ts`
- Test: `tests/unit/providers/overrides.test.ts`

**Interfaces:**
- Consumes: 现有 `provider_configs.params_json` JSON 字符串（`string | null`）
- Produces: `parseProviderParams(json: string | null): ProviderParams`；`mergeOverrides(req: ChatRequest, params: ProviderParams): {headers, body}`

**Steps:**

- [ ] **Step 1: 写测试**

`tests/unit/providers/overrides.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseProviderParams, mergeOverrides } from '@main/providers/overrides';
import type { ChatRequest } from '@main/providers/types';

describe('parseProviderParams', () => {
  it('returns empty object for null', () => {
    expect(parseProviderParams(null)).toEqual({});
  });
  it('returns empty object for invalid JSON', () => {
    expect(parseProviderParams('not-json{')).toEqual({});
  });
  it('parses existing defaultModel shape', () => {
    expect(parseProviderParams('{"defaultModel":"claude-sonnet-4-5"}')).toEqual({
      defaultModel: 'claude-sonnet-4-5',
    });
  });
  it('parses extraHeaders/extraBody/modelOverrides', () => {
    const json = JSON.stringify({
      extraHeaders: { 'X-Custom': 'foo' },
      extraBody: { providerParam: true },
      modelOverrides: { 'claude-sonnet-4-5': { thinkingBudget: 8192 } },
    });
    expect(parseProviderParams(json)).toEqual({
      extraHeaders: { 'X-Custom': 'foo' },
      extraBody: { providerParam: true },
      modelOverrides: { 'claude-sonnet-4-5': { thinkingBudget: 8192 } },
    });
  });
});

describe('mergeOverrides', () => {
  const req: ChatRequest = {
    model: 'claude-sonnet-4-5',
    messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.7,
  };
  it('passes through when params empty', () => {
    const { headers, body } = mergeOverrides(req, {});
    expect(headers).toEqual({});
    expect(body).toEqual({ temperature: 0.7 });
  });
  it('provider-level extraHeaders applied', () => {
    const { headers } = mergeOverrides(req, { extraHeaders: { 'X-A': '1' } });
    expect(headers).toEqual({ 'X-A': '1' });
  });
  it('per-model overrides beat provider-level', () => {
    const { headers, body } = mergeOverrides(req, {
      extraHeaders: { 'X-A': '1' },
      modelOverrides: { 'claude-sonnet-4-5': { extraHeaders: { 'X-A': '2' } } },
    });
    expect(headers).toEqual({ 'X-A': '2' });
  });
  it('chatRequest fields win over overrides', () => {
    const { body } = mergeOverrides(req, {
      extraBody: { temperature: 0.5 },
    });
    expect(body.temperature).toBe(0.7);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/providers/overrides.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 overrides.ts**

`src/main/providers/overrides.ts`：

```ts
import type { ChatRequest } from './types';

export interface ModelOverride {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  toolChoice?: string;
  thinkingBudget?: number;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  safetySettings?: unknown;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
}

export interface ProviderParams {
  defaultModel?: string;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  modelOverrides?: Record<string, ModelOverride>;
}

export function parseProviderParams(json: string | null | undefined): ProviderParams {
  if (!json) return {};
  try {
    return JSON.parse(json) as ProviderParams;
  } catch {
    return {};
  }
}

/**
 * Merge precedence (low → high):
 *   extraHeaders/extraBody (provider-level)
 *   → modelOverrides[req.model]
 *   → ChatRequest runtime fields (temperature, maxTokens)
 */
export function mergeOverrides(
  req: ChatRequest,
  params: ProviderParams,
): { headers: Record<string, string>; body: Record<string, unknown> } {
  const mo = params.modelOverrides?.[req.model] ?? {};
  const headers: Record<string, string> = {
    ...(params.extraHeaders ?? {}),
    ...(mo.extraHeaders ?? {}),
  };
  const body: Record<string, unknown> = {
    ...(params.extraBody ?? {}),
    ...stripUndefined(mo),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
  };
  return { headers, body };
}

function stripUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) (out as any)[k] = v;
  }
  return out;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/unit/providers/overrides.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: Commit**

```bash
git add src/main/providers/overrides.ts tests/unit/providers/overrides.test.ts
git commit -m "feat(providers): add overrides parser with per-model merging"
```

---

### Task 1.2: `OpenAIProvider` 接受 `parsedParams`

**Files:**
- Modify: `src/main/providers/openai.ts`（构造签名 + 调用点）

**Interfaces:**
- Consumes: `ProviderParams`（Task 1.1）
- Produces: 构造签名加 `parsedParams?: ProviderParams = {}`；`chat()` 把 `extraHeaders` 合并到 SDK 的 `defaultHeaders`，把 `extraBody` 合并到 `create()` 的 body

**Steps:**

- [ ] **Step 1: 改写 OpenAIProvider 构造与 chat**

阅读 `src/main/providers/openai.ts` 当前实现（4 个方法：构造函数、`chat`、`reasoningParam`、`capabilities`）。修改：

构造函数（顶部）加字段：

```ts
import { mergeOverrides, type ProviderParams } from './overrides';

class OpenAIProvider implements LLMProvider {
  // 现有字段保留...
  private parsedParams: ProviderParams;

  constructor(id: string, configId: string, apiKey: string, baseURL?: string, parsedParams: ProviderParams = {}) {
    this.id = id;
    this.configId = configId;
    this.client = new OpenAI({ apiKey, baseURL });
    this.parsedParams = parsedParams;
  }
  // ...
}
```

`chat()` 内调用 `client.chat.completions.create({...})` 之前：

```ts
const { headers, body: bodyOverrides } = mergeOverrides(req, this.parsedParams);
// 在 stream 请求里：
const stream = await this.client.chat.completions.create(
  {
    model: req.model,
    messages: messages as any,
    ...bodyOverrides,                    // ← 新增
    stream: true,
    ...(tools ? { tools } : {}),
    ...reasoning,
  },
  {
    signal,
    defaultHeaders: headers,             // ← 新增
  } as any,
);
```

> 注意：`reasoning_effort` 由现有 `reasoningParam()` 返回，会被 `bodyOverrides` 覆盖（ChatRequest 最高优先级）。验证 `reasoningParam` 不被吞：若 `bodyOverrides` 有 `reasoning_effort` 则使用，否则用 `reasoningParam()`。最简方案 — 先 spread `bodyOverrides`，再 spread `...reasoning`：

```ts
{
  model: req.model,
  messages: messages as any,
  ...bodyOverrides,
  stream: true,
  ...(tools ? { tools } : {}),
  ...reasoning,
}
```

`reasoningParam()` 里的 `reasoning_effort` 在 `bodyOverrides` 没设时被加进来，符合预期。

- [ ] **Step 2: 跑既有测试确认无回归**

Run: `npx vitest run tests/unit tests/integration`
Expected: PASS（既有 openai 测试若有；若失败修正后再跑）

- [ ] **Step 3: Commit**

```bash
git add src/main/providers/openai.ts
git commit -m "feat(openai): accept parsedParams and merge overrides"
```

---

### Task 1.3: `OpenAICompatProvider` 接受 `parsedParams`

**Files:**
- Modify: `src/main/providers/openai-compat.ts`

**Interfaces:**
- Consumes: `ProviderParams`
- Produces: 父类已支持（继承自 OpenAIProvider），但 Azure 路径（`azureClient`）需要单独处理

**Steps:**

- [ ] **Step 1: 改写构造签名透传 + Azure chat 调用合并**

构造函数（extends OpenAIProvider 路径已自动支持）：

```ts
constructor(id: string, configId: string, apiKey: string, baseURL: string, parsedParams: ProviderParams = {}) {
  super(id, configId, apiKey, baseURL, parsedParams);
  // ... 既有 azureClient 初始化 ...
}
```

Azure `chat()` 分支（`azureClient.chat.completions.create({...})`）前加：

```ts
const { headers, body: bodyOverrides } = mergeOverrides(req, this.parsedParams as ProviderParams);
// 在 create 调用里：
{
  model: req.model,
  messages: messages as any,
  ...bodyOverrides,
  temperature: req.temperature,    // 现有 — 但 bodyOverrides 可能已含 temperature
  max_tokens: req.maxTokens,
  stream: true,
  ...(tools ? { tools } : {}),
}
```

> 注意：Azure 分支原本就有 `temperature/max_tokens` 直接展开。改为 spread `bodyOverrides` 优先，`req.temperature/maxTokens` 仍透传（mergeOverrides 已把 `req.temperature` 放进 bodyOverrides）。删除原始两行，保留 spread 后的值。

```ts
{
  model: req.model,
  messages: messages as any,
  ...bodyOverrides,
  stream: true,
  ...(tools ? { tools } : {}),
},
{
  signal,
  defaultHeaders: headers,
} as any,
```

- [ ] **Step 2: 跑既有测试**

Run: `npx vitest run tests/unit tests/integration`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/providers/openai-compat.ts
git commit -m "feat(openai-compat): accept parsedParams and merge overrides"
```

---

### Task 1.4: `OllamaProvider` 接受 `parsedParams`

**Files:**
- Modify: `src/main/providers/ollama.ts`

**Interfaces:**
- Consumes: `ProviderParams`
- Produces: 构造签名加 `parsedParams?: ProviderParams = {}`；Ollama SDK 支持 `defaultHeaders`（与 OpenAI 兼容）

**Steps:**

- [ ] **Step 1: 改写构造与 chat 调用**

构造函数加：

```ts
import { mergeOverrides, type ProviderParams } from './overrides';

class OllamaProvider implements LLMProvider {
  private parsedParams: ProviderParams;

  constructor(id: string, configId: string, baseURL?: string, parsedParams: ProviderParams = {}) {
    // 现有初始化保留...
    this.parsedParams = parsedParams;
  }
}
```

`chat()` 内 Ollama chat 调用前：

```ts
const { headers, body: bodyOverrides } = mergeOverrides(req, this.parsedParams);
const response = await this.client.chat({
  model: req.model,
  messages: messages as any,
  ...bodyOverrides,
  stream: true,
}, {
  headers,                              // Ollama SDK 的 options.headers
} as any);
```

> 检查 Ollama SDK 是否接受 `headers` 选项；若不支持则只在 body 合并。

- [ ] **Step 2: 跑既有测试**

Run: `npx vitest run tests/unit tests/integration`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/providers/ollama.ts
git commit -m "feat(ollama): accept parsedParams and merge overrides"
```

---

### Task 1.5: `AnthropicProvider` 构造签名加 `parsedParams`

**Files:**
- Modify: `src/main/providers/anthropic.ts`

**Interfaces:**
- Consumes: `ProviderParams`（Task 1.1）
- Produces: 构造签名加 `parsedParams?: ProviderParams = {}`，存为 `this.parsedParams`；chat() 行为不变（overrides 应用推迟到 Task 2.1）

**Steps:**

- [ ] **Step 1: 改写构造（chat 不变）**

```ts
import type { ProviderParams } from './overrides';

class AnthropicProvider implements LLMProvider {
  private parsedParams: ProviderParams;

  constructor(id: string, configId: string, apiKey: string, parsedParams: ProviderParams = {}) {
    this.id = id;
    this.configId = configId;
    this.client = new Anthropic({ apiKey });
    this.parsedParams = parsedParams;
  }

  // chat() 既有实现保持不变；overrides 应用在 Task 2.1 统一搬到 anthropic-base.ts
}
```

> `chat()` 内 `client.messages.stream({...})` 调用 **不变**。overrides 应用与 `thinkingBudget → thinking.budget_tokens` 翻译统一在 Task 2.1 的 `anthropic-base.ts` 完成。本 Task 只让 AnthropicProvider 构造签名匹配协议，确保 Phase 2 重构时无签名变化、chat 行为零回归。

- [ ] **Step 2: 跑既有测试**

Run: `npx vitest run tests/unit tests/integration`
Expected: PASS（chat 行为不变）

- [ ] **Step 3: Commit**

```bash
git add src/main/providers/anthropic.ts
git commit -m "refactor(anthropic): accept parsedParams (chat 应用留 Phase 2)"
```

---

### Task 1.6: `factory.ts` 解析 `params_json` 并透传

**Files:**
- Modify: `src/main/providers/factory.ts`

**Interfaces:**
- Consumes: `parseProviderParams()`（Task 1.1）
- Produces: 每个 provider 构造都传第 5 参数 `parsedParams`

**Steps:**

- [ ] **Step 1: 改写 factory.ts**

```ts
import { parseProviderParams } from './overrides';

export function loadProviders(db: Database.Database, secrets: SecretStore, reg: ProviderRegistry): void {
  const rows = db.prepare('SELECT * FROM provider_configs WHERE enabled = 1').all() as any[];

  for (const row of rows) {
    if (row.id === '_classifier') continue;
    const apiKey = secrets.get(row.id);
    if (!apiKey && row.type !== 'ollama') continue;

    const parsed = parseProviderParams(row.params_json);

    let provider: any;
    switch (row.type) {
      case 'openai':
        provider = new OpenAIProvider(row.id, row.id, apiKey!, row.base_url || undefined, parsed);
        break;
      case 'anthropic':
        provider = new AnthropicProvider(row.id, row.id, apiKey!, parsed);
        break;
      case 'ollama':
        provider = new OllamaProvider(row.id, row.id, row.base_url, parsed);
        break;
      case 'openai-compat':
        if (!row.base_url) continue;
        provider = new OpenAICompatProvider(row.id, row.id, apiKey!, row.base_url, parsed);
        break;
    }
    if (provider) reg.register(provider);
  }
}
```

- [ ] **Step 2: 跑既有测试**

Run: `npx vitest run tests/unit tests/integration`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/providers/factory.ts
git commit -m "feat(factory): parse params_json and pass parsedParams"
```

---

### Task 1.7: provider-router `configure` zod schema 扩展

**Files:**
- Modify: `src/main/ipc/routers/provider-router.ts`

**Interfaces:**
- Consumes: trpc 输入 schema
- Produces: `configure` mutation 的 zod input 加 `extraHeaders/extraBody/modelOverrides`

**Steps:**

- [ ] **Step 1: 改写 configure input**

`configure` mutation 当前：

```ts
.input(
  z.object({
    id: z.string(),
    type: z.enum(['openai', 'anthropic', 'ollama', 'openai-compat']),
    apiKey: z.string().optional(),
    baseURL: z.string().optional(),
    defaultModel: z.string().optional(),
  }),
)
```

改为：

```ts
.input(
  z.object({
    id: z.string(),
    type: z.enum(['openai', 'anthropic', 'ollama', 'openai-compat']),
    apiKey: z.string().optional(),
    baseURL: z.string().optional(),
    defaultModel: z.string().optional(),
    extraHeaders: z.record(z.string(), z.string()).optional(),
    extraBody: z.record(z.string(), z.unknown()).optional(),
    modelOverrides: z.record(z.string(), z.record(z.unknown())).optional(),
  }),
)
```

mutation 体：

```ts
const paramsObj: Record<string, unknown> = {};
if (input.defaultModel !== undefined) paramsObj.defaultModel = input.defaultModel;
if (input.extraHeaders !== undefined) paramsObj.extraHeaders = input.extraHeaders;
if (input.extraBody !== undefined) paramsObj.extraBody = input.extraBody;
if (input.modelOverrides !== undefined) paramsObj.modelOverrides = input.modelOverrides;
const paramsJson = Object.keys(paramsObj).length > 0 ? JSON.stringify(paramsObj) : null;

db.prepare(
  `INSERT INTO provider_configs(id, type, name, base_url, params_json)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET type = excluded.type, base_url = excluded.base_url, params_json = excluded.params_json`,
).run(input.id, input.type, input.id, input.baseURL ?? null, paramsJson);
```

- [ ] **Step 2: 跑既有测试**

Run: `npx vitest run tests/unit tests/integration`
Expected: PASS（既有 configure 行为不变，新字段默认 undefined）

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/routers/provider-router.ts
git commit -m "feat(provider-router): accept extraHeaders/extraBody/modelOverrides in configure"
```

---

### Task 1.8: settings-store 透传新字段

**Files:**
- Modify: `src/renderer/stores/settings-store.ts`

**Interfaces:**
- Consumes: UI 层输入
- Produces: `addProvider` 透传到 `trpc.provider.configure.mutate()`

**Steps:**

- [ ] **Step 1: 改写 addProvider 签名**

```ts
addProvider: (config: {
  id: string;
  type: string;
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  modelOverrides?: Record<string, Record<string, unknown>>;
}) => Promise<void>;
```

调用：

```ts
addProvider: async (config) => {
  await trpc.provider.configure.mutate({
    id: config.id,
    type: config.type as any,
    apiKey: config.apiKey || undefined,
    baseURL: config.baseURL,
    defaultModel: config.defaultModel,
    extraHeaders: config.extraHeaders,
    extraBody: config.extraBody,
    modelOverrides: config.modelOverrides,
  });
  await get().refreshProviders();
},
```

- [ ] **Step 2: 跑既有测试**

Run: `npx vitest run tests/unit tests/integration`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/stores/settings-store.ts
git commit -m "feat(settings-store): pass extraHeaders/extraBody/modelOverrides"
```

---

### Task 1.9: ProviderForm.tsx — Advanced 折叠区

**Files:**
- Modify: `src/renderer/components/ProviderForm.tsx`

**Interfaces:**
- Consumes: 用户输入
- Produces: `addProvider()` 调用时携带 `extraHeaders / extraBody / modelOverrides`

**Steps:**

- [ ] **Step 1: 读当前 ProviderForm.tsx 理解结构**

Read 整个文件（约 587 行）。找：
- type 选择器位置（决定 type-specific 字段渲染）
- 现有 type-specific 字段（apiKey/baseURL/defaultModel）
- 表单提交回调（调用 `addProvider`）

> 重点：本 task 只做"Advanced 折叠区"，不动 type 选择。type 下拉扩展留到 Phase 2/3。

- [ ] **Step 2: 加折叠区 state**

组件顶部：

```ts
const [showAdvanced, setShowAdvanced] = useState(false);
const [extraHeaders, setExtraHeaders] = useState<Array<{key: string; value: string}>>([]);
const [extraBodyText, setExtraBodyText] = useState('');
const [extraBodyError, setExtraBodyError] = useState<string | null>(null);
```

- [ ] **Step 3: 在 defaultModel 字段后渲染折叠区**

```tsx
<button type="button" onClick={() => setShowAdvanced(v => !v)} className="...">
  {showAdvanced ? '▼' : '▶'} Advanced
</button>

{showAdvanced && (
  <div className="border border-rule rounded p-3 mt-2 space-y-3">
    <div>
      <label className="text-[12px] text-ink-muted">Extra Headers</label>
      {extraHeaders.map((h, i) => (
        <div key={i} className="flex gap-2 mt-1">
          <input
            value={h.key}
            placeholder="Header name"
            onChange={e => setExtraHeaders(arr => arr.map((x, j) => j === i ? {...x, key: e.target.value} : x))}
            className="flex-1 px-2 py-1 border border-rule rounded text-[13px]"
          />
          <input
            value={h.value}
            placeholder="Value"
            onChange={e => setExtraHeaders(arr => arr.map((x, j) => j === i ? {...x, value: e.target.value} : x))}
            className="flex-1 px-2 py-1 border border-rule rounded text-[13px]"
          />
          <button type="button" onClick={() => setExtraHeaders(arr => arr.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setExtraHeaders(arr => [...arr, {key: '', value: ''}])}
        className="mt-2 text-[12px] text-accent"
      >+ Add header</button>
    </div>

    <div>
      <label className="text-[12px] text-ink-muted">Extra Body (JSON)</label>
      <textarea
        value={extraBodyText}
        placeholder='{"key": "value"}'
        onChange={e => setExtraBodyText(e.target.value)}
        onBlur={() => {
          if (!extraBodyText.trim()) { setExtraBodyError(null); return; }
          try { JSON.parse(extraBodyText); setExtraBodyError(null); }
          catch (err) { setExtraBodyError(err instanceof Error ? err.message : String(err)); }
        }}
        rows={4}
        className="w-full mt-1 px-2 py-1 border border-rule rounded text-[13px] font-mono"
      />
      {extraBodyError && <div className="text-[12px] text-red-500 mt-1">Invalid JSON: {extraBodyError}</div>}
    </div>
  </div>
)}
```

- [ ] **Step 4: 提交时构造对象**

找到 `addProvider(config)` 调用点，改：

```ts
const extraHeadersObj: Record<string, string> = {};
for (const h of extraHeaders) {
  if (h.key.trim()) extraHeadersObj[h.key.trim()] = h.value;
}
let extraBodyObj: Record<string, unknown> | undefined;
if (extraBodyText.trim()) {
  try { extraBodyObj = JSON.parse(extraBodyText); }
  catch { /* 不提交坏 JSON — blur 时已显示错误 */ }
}

await addProvider({
  // ... 既有字段
  extraHeaders: Object.keys(extraHeadersObj).length ? extraHeadersObj : undefined,
  extraBody: extraBodyObj,
  // modelOverrides 留 Phase 1 之后 task 添加（可选）
});
```

- [ ] **Step 5: 跑 UI 测试 + TypeScript 类型检查**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS（类型对齐）

Run: `npx vitest run tests/unit tests/integration`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/ProviderForm.tsx
git commit -m "feat(ProviderForm): add Advanced section for extraHeaders/extraBody"
```

---

### Task 1.10: 集成测试 — ProviderForm configure factory 端到端

**Files:**
- Create: `tests/integration/provider-config-flow.test.ts`

**Interfaces:**
- Consumes: `parseProviderParams()` + `mergeOverrides()` 真实输出 + provider 构造签名
- Produces: 验证"DB JSON → parsedParams → SDK options"链路

**Steps:**

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect } from 'vitest';
import { parseProviderParams, mergeOverrides } from '@main/providers/overrides';
import type { ChatRequest } from '@main/providers/types';

describe('provider config flow', () => {
  it('persists and reads back extraHeaders/extraBody/modelOverrides', () => {
    const input = {
      defaultModel: 'claude-sonnet-4-5',
      extraHeaders: { 'X-Custom': 'foo' },
      extraBody: { providerParam: 42 },
      modelOverrides: {
        'claude-sonnet-4-5': { thinkingBudget: 8192 },
      },
    };
    const json = JSON.stringify(input);
    const parsed = parseProviderParams(json);
    expect(parsed).toEqual(input);
  });

  it('merged output reaches SDK options correctly', () => {
    const req: ChatRequest = {
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.5,
    };
    const params = parseProviderParams(JSON.stringify({
      extraHeaders: { 'X-A': '1' },
      extraBody: { top_p: 0.9 },
      modelOverrides: {
        'claude-sonnet-4-5': { temperature: 0.3, extraBody: { top_p: 0.8 } },
      },
    }));
    const merged = mergeOverrides(req, params);
    expect(merged.headers).toEqual({ 'X-A': '1' });
    // runtime req.temperature wins over modelOverride.temperature
    expect(merged.body.temperature).toBe(0.5);
    // modelOverride.extraBody beats provider.extraBody
    expect((merged.body as any).top_p).toBe(0.8);
  });

  it('corrupted params_json returns empty params', () => {
    expect(parseProviderParams('not-json{')).toEqual({});
    expect(parseProviderParams('{')).toEqual({});
  });
});
```

- [ ] **Step 2: 跑测试确认通过**

Run: `npx vitest run tests/integration/provider-config-flow.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/provider-config-flow.test.ts
git commit -m "test: provider-config end-to-end flow"
```

---

## Phase 2 — `anthropic-messages` provider

### Task 2.1: 提取 `base/anthropic-base.ts`

**Files:**
- Create: `src/main/providers/base/anthropic-base.ts`
- Modify: `src/main/providers/anthropic.ts`

**Interfaces:**
- Consumes: `ChatRequest`、`ProviderParams`
- Produces: 协议基类 `AnthropicBaseProvider`，`anthropic.ts` 改为 `class AnthropicProvider extends AnthropicBaseProvider`

**Steps:**

- [ ] **Step 1: 创建 anthropic-base.ts**

```ts
import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, ChatRequest, ChatChunk, Model, ChatMessage, ToolCall, ProviderCapabilities } from '../types';
import { normalizeError } from '../errors';
import { inferCaps } from '../caps-heuristics';
import { mergeOverrides, type ProviderParams } from '../overrides';

export abstract class AnthropicBaseProvider implements LLMProvider {
  public readonly id: string;
  public readonly configId: string;
  protected client: Anthropic;
  protected parsedParams: ProviderParams;

  constructor(id: string, configId: string, apiKey: string, clientOptions: Record<string, unknown>, parsedParams: ProviderParams = {}) {
    this.id = id;
    this.configId = configId;
    this.client = new Anthropic({ apiKey, ...clientOptions });
    this.parsedParams = parsedParams;
  }

  abstract listModels(): Promise<Model[]>;

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
    const messages = toAnthropicMessages(req.messages as ChatMessage[]);
    const tools = req.tools?.length
      ? req.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: (t.inputSchema ?? { type: 'object', properties: {} }) as any,
        }))
      : undefined;

    const thinking = anthropicThinkingParams(req);
    const { headers, body: bodyOverrides } = mergeOverrides(req, this.parsedParams);

    // thinkingBudget → thinking.budget_tokens 翻译
    if (thinking && (bodyOverrides as any).thinkingBudget !== undefined) {
      thinking.budget_tokens = (bodyOverrides as any).thinkingBudget;
      delete (bodyOverrides as any).thinkingBudget;
    }

    const maxTokens = thinking
      ? Math.max(req.maxTokens ?? 4096, thinking.budget_tokens + 1024)
      : (req.maxTokens ?? 4096);

    try {
      const stream: any = await this.client.messages.stream(
        {
          model: req.model,
          messages: messages as any,
          system: req.systemPrompt,
          ...(thinking ? {} : { temperature: req.temperature }),
          max_tokens: maxTokens,
          ...(tools ? { tools } : {}),
          ...(thinking ? { thinking } : {}),
          ...bodyOverrides,
        } as any,
        { signal, defaultHeaders: headers } as any,
      );

      const toolBuf = new Map<number, { id: string; name: string; argText: string }>();
      let stopReason: string | null = null;

      for await (const event of stream as AsyncIterable<any>) {
        const t = event.type;
        if (t === 'content_block_start') {
          const cb = event.content_block;
          if (cb?.type === 'tool_use') {
            toolBuf.set(event.index, { id: cb.id, name: cb.name, argText: '' });
          }
        } else if (t === 'content_block_delta') {
          if (event.delta?.type === 'text_delta') yield { delta: event.delta.text };
          else if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
            yield { reasoningDelta: event.delta.thinking };
          } else if (event.delta?.type === 'input_json_delta') {
            const buf = toolBuf.get(event.index);
            if (buf) buf.argText += event.delta.partial_json ?? '';
          }
        } else if (t === 'message_delta') {
          if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
        }
      }

      let final: any = null;
      try { final = await stream.finalMessage(); } catch { /* abort */ }
      const usage = final?.usage
        ? { promptTokens: final.usage.input_tokens, completionTokens: final.usage.output_tokens }
        : undefined;
      const finalStop = final?.stop_reason ?? stopReason;

      let toolCalls: ToolCall[] | undefined;
      if (finalStop === 'tool_use' && toolBuf.size > 0) {
        toolCalls = [];
        const indices = Array.from(toolBuf.keys()).sort((a, b) => a - b);
        for (const i of indices) {
          const b = toolBuf.get(i)!;
          let parsed: Record<string, unknown> = {};
          try { parsed = b.argText ? JSON.parse(b.argText) : {}; }
          catch { parsed = { _raw: b.argText }; }
          toolCalls.push({ id: b.id, name: b.name, arguments: parsed });
        }
      }

      const finishReason: ChatChunk['finishReason'] =
        finalStop === 'end_turn' ? 'stop' :
        finalStop === 'max_tokens' ? 'length' :
        finalStop === 'tool_use' ? 'tool_calls' : 'error';
      yield { finishReason, usage, ...(toolCalls ? { toolCalls } : {}) };
    } catch (err) {
      const n = normalizeError(err);
      if (n.code === 'ABORTED') return;
      throw n;
    }
  }

  capabilities(model: string): ProviderCapabilities {
    return {
      vision: /(claude-3|claude-opus|claude-sonnet|claude-haiku)/i.test(model),
      reasoning: supportsExtendedThinking(model),
      tools: true,
    };
  }
}

// 既有 helpers：toAnthropicMessages / supportsExtendedThinking / anthropicThinkingParams / ANTHROPIC_THINKING_BUDGET
// 拷贝自 anthropic.ts（保持导出名不变以避免破坏 provider-router 等引用）
export function toAnthropicMessages(messages: ChatMessage[]): any[] { /* 复制原实现 */ }
export function supportsExtendedThinking(model: string): boolean { /* 复制原实现 */ }
export function anthropicThinkingParams(req: ChatRequest): { type: 'enabled'; budget_tokens: number } | null { /* 复制原实现 */ }
```

> 把 anthropic.ts 中 `toAnthropicMessages / supportsExtendedThinking / anthropicThinkingParams / ANTHROPIC_THINKING_BUDGET` 的实现完整复制到 anthropic-base.ts，然后从 anthropic.ts 删除。

- [ ] **Step 2: 改写 anthropic.ts**

```ts
import { AnthropicBaseProvider, toAnthropicMessages, supportsExtendedThinking, anthropicThinkingParams } from './base/anthropic-base';
import type { Model } from './types';
import { inferCaps } from './caps-heuristics';
import type { ProviderParams } from './overrides';

export class AnthropicProvider extends AnthropicBaseProvider {
  constructor(id: string, configId: string, apiKey: string, parsedParams: ProviderParams = {}) {
    super(id, configId, apiKey, {}, parsedParams);
  }

  async listModels(): Promise<Model[]> {
    try {
      const res = await this.client.models.list();
      return res.data.map((m) => ({
        id: m.id,
        name: m.id,
        contextWindow: (m as any)?.metadata?.context_window_size ?? 200_000,
        caps: inferCaps(m.id),
      }));
    } catch {
      return [
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', contextWindow: 200_000, caps: inferCaps('claude-sonnet-4-20250514') },
        { id: 'claude-opus-4-0', name: 'Claude Opus 4', contextWindow: 200_000, caps: inferCaps('claude-opus-4-0') },
        { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', contextWindow: 200_000, caps: inferCaps('claude-haiku-4-5-20251001') },
      ];
    }
  }
}

// Re-export helpers for backwards compat (其他文件可能 import）
export { toAnthropicMessages, supportsExtendedThinking, anthropicThinkingParams };
```

- [ ] **Step 3: 跑测试**

Run: `npx vitest run tests/unit tests/integration`
Expected: PASS（既有 anthropic 测试若有）

- [ ] **Step 4: Commit**

```bash
git add src/main/providers/base/anthropic-base.ts src/main/providers/anthropic.ts
git commit -m "refactor(anthropic): extract AnthropicBaseProvider for subclassing"
```

---

### Task 2.2: 创建 `anthropic-messages.ts`

**Files:**
- Create: `src/main/providers/anthropic-messages.ts`

**Interfaces:**
- Consumes: `AnthropicBaseProvider`（Task 2.1）
- Produces: 通用 Anthropic Messages 兼容 provider，构造接 `baseURL`

**Steps:**

- [ ] **Step 1: 实现 anthropic-messages**

```ts
import { AnthropicBaseProvider } from './base/anthropic-base';
import type { Model } from './types';
import { inferCaps } from './caps-heuristics';
import type { ProviderParams } from './overrides';

/**
 * Generic Anthropic Messages-compatible provider.
 *
 * Use baseURL to point at any vendor that exposes the Anthropic Messages
 * protocol (e.g. Minimax, self-hosted proxies). SDK auth header is
 * forwarded; vendors needing custom auth (AWS SigV4, GCP tokens) are not
 * supported by this class — implement a vendor subclass instead.
 */
export class AnthropicMessagesProvider extends AnthropicBaseProvider {
  constructor(id: string, configId: string, apiKey: string, baseURL: string, parsedParams: ProviderParams = {}) {
    super(id, configId, apiKey, { baseURL }, parsedParams);
  }

  async listModels(): Promise<Model[]> {
    // 通用：返回本地 heuristic 列表 + 让用户手动输入 model id
    const guesses = ['claude-sonnet-4-5', 'claude-opus-4-0', 'claude-haiku-4-5-20251001'];
    return guesses.map(id => ({
      id,
      name: id,
      contextWindow: 200_000,
      caps: inferCaps(id),
    }));
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/providers/anthropic-messages.ts
git commit -m "feat(providers): add AnthropicMessagesProvider for custom baseURL"
```

---

### Task 2.3: 测试 anthropic-messages

**Files:**
- Create: `tests/unit/providers/anthropic-messages.test.ts`

**Steps:**

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect, vi } from 'vitest';
import { AnthropicMessagesProvider } from '@main/providers/anthropic-messages';

// Mock the @anthropic-ai/sdk module
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation((opts: any) => {
      // Capture options so the test can assert
      (globalThis as any).__anthropicOpts = opts;
      return {
        models: { list: async () => ({ data: [] }) },
        messages: { stream: async () => (async function* () { yield { type: 'message_stop' }; })() },
      };
    }),
  };
});

describe('AnthropicMessagesProvider', () => {
  it('passes baseURL to SDK constructor', () => {
    new AnthropicMessagesProvider('id', 'cfg', 'key', 'https://api.example.com', {});
    expect((globalThis as any).__anthropicOpts).toMatchObject({
      apiKey: 'key',
      baseURL: 'https://api.example.com',
    });
  });

  it('returns guess-list when listModels is called without a real endpoint', async () => {
    const p = new AnthropicMessagesProvider('id', 'cfg', 'key', 'https://api.example.com', {});
    const models = await p.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.every(m => typeof m.id === 'string')).toBe(true);
  });

  it('capsabilities: vision and reasoning for known Claude model ids', () => {
    const p = new AnthropicMessagesProvider('id', 'cfg', 'key', 'https://x', {});
    const caps = p.capabilities('claude-sonnet-4-5');
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.tools).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认通过**

Run: `npx vitest run tests/unit/providers/anthropic-messages.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/unit/providers/anthropic-messages.test.ts
git commit -m "test(anthropic-messages): constructor + listModels + capabilities"
```

---

### Task 2.4: factory 加 anthropic-messages case

**Files:**
- Modify: `src/main/providers/factory.ts`

**Steps:**

- [ ] **Step 1: 加 case**

```ts
import { AnthropicMessagesProvider } from './anthropic-messages';

// 在 switch 内：
case 'anthropic-messages':
  if (!row.base_url) continue;
  provider = new AnthropicMessagesProvider(row.id, row.id, apiKey!, row.base_url, parsed);
  break;
```

- [ ] **Step 2: 跑测试**

Run: `npx vitest run tests/unit tests/integration`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/providers/factory.ts
git commit -m "feat(factory): register anthropic-messages type"
```

---

### Task 2.5: provider-router enum 扩展 + listModels/testModel 同步

**Files:**
- Modify: `src/main/ipc/routers/provider-router.ts`

**Steps:**

- [ ] **Step 1: 扩展所有相关 zod enum**

`configure`、`listModels`、`testModel` 的 zod enum：

```ts
z.enum(['openai', 'anthropic', 'ollama', 'openai-compat', 'anthropic-messages'])
```

`getConfig` 返回的 type cast 同步扩展。

`listModels/testModel` 的 switch 加 case：

```ts
case 'anthropic-messages':
  if (!input.baseURL) return { ok: false as const, error: 'baseURL required for anthropic-messages' };
  provider = new AnthropicMessagesProvider('__probe__', '__probe__', input.apiKey ?? '', input.baseURL);
  break;
```

加 import：

```ts
import { AnthropicMessagesProvider } from '../../providers/anthropic-messages';
```

- [ ] **Step 2: 跑测试**

Run: `npx vitest run tests/unit tests/integration`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/routers/provider-router.ts
git commit -m "feat(provider-router): expose anthropic-messages in all enums"
```

---

### Task 2.6: ProviderForm — type 下拉加 `anthropic-messages`

**Files:**
- Modify: `src/renderer/components/ProviderForm.tsx`

**Steps:**

- [ ] **Step 1: 找 type 选择器**

Read ProviderForm.tsx 找 type 下拉（一般在头部）。当前 type 选项数组：

```ts
const PROVIDER_TYPES = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'openai-compat', label: 'OpenAI Compatible' },
];
```

改为：

```ts
const PROVIDER_TYPES = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'openai-compat', label: 'OpenAI Compatible' },
  { value: 'anthropic-messages', label: 'Anthropic Messages (custom URL)' },
];
```

- [ ] **Step 2: type-specific 字段**

找到根据 type 渲染 baseURL/apiKey 等条件的代码块：

```tsx
{type === 'openai-compat' && (
  <Field label="Base URL" required>
    <input value={baseURL} onChange={...} placeholder="https://api.example.com/v1" />
  </Field>
)}
```

扩展为：

```tsx
{(type === 'openai-compat' || type === 'anthropic-messages') && (
  <Field label="Base URL" required>
    <input value={baseURL} onChange={...} placeholder={
      type === 'anthropic-messages' ? 'https://api.example.com' : 'https://api.example.com/v1'
    } />
  </Field>
)}
{type === 'anthropic-messages' && (
  <p className="text-[12px] text-ink-muted mt-1">
    Any Anthropic Messages compatible endpoint (Minimax, self-hosted proxies).
    Vendors needing custom auth (AWS SigV4, GCP) require a custom subclass.
  </p>
)}
```

- [ ] **Step 3: 类型检查 + 测试**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ProviderForm.tsx
git commit -m "feat(ProviderForm): expose anthropic-messages type"
```

---

## Phase 3 — Gemini 原生 provider

### Task 3.1: 安装 `@google/genai`

**Steps:**

- [ ] **Step 1: npm install**

Run: `npm install @google/genai`
Expected: package.json + package-lock.json 更新；安装完成无错

- [ ] **Step 2: 验证 import 成功**

Run: `node -e "import('@google/genai').then(m => console.log(Object.keys(m).slice(0,5)))"`
Expected: 输出 `['GoogleGenAI', ...]` 或类似

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add @google/genai"
```

---

### Task 3.2: 创建 `gemini.ts`

**Files:**
- Create: `src/main/providers/gemini.ts`

**Interfaces:**
- Consumes: `ChatRequest`、`ProviderParams`
- Produces: `GeminiProvider implements LLMProvider`

**Steps:**

- [ ] **Step 1: 写测试**

`tests/unit/providers/gemini.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@google/genai', () => {
  const mockStream = {
    async *[Symbol.asyncIterator]() {
      yield { candidates: [{ content: { parts: [{ text: 'hi' }] } }] };
      yield { candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 } };
    },
  };
  return {
    GoogleGenAI: vi.fn().mockImplementation((opts: any) => {
      (globalThis as any).__geminiOpts = opts;
      return {
        models: {
          list: async () => [{ name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' }],
        },
        chats: {
          create: () => ({
            sendMessageStream: async () => mockStream,
          }),
        },
      };
    }),
  };
});

import { GeminiProvider } from '@main/providers/gemini';
import type { ChatRequest } from '@main/providers/types';

describe('GeminiProvider', () => {
  it('passes apiKey to SDK constructor', () => {
    new GeminiProvider('id', 'cfg', 'key', undefined, {});
    expect((globalThis as any).__geminiOpts).toMatchObject({ apiKey: 'key' });
  });

  it('listModels returns SDK list', async () => {
    const p = new GeminiProvider('id', 'cfg', 'key', undefined, {});
    const models = await p.listModels();
    expect(models.length).toBeGreaterThan(0);
  });

  it('chat yields delta + finish chunks', async () => {
    const p = new GeminiProvider('id', 'cfg', 'key', undefined, {});
    const req: ChatRequest = {
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hi' }],
    };
    const chunks: any[] = [];
    for await (const c of p.chat(req, new AbortController().signal)) chunks.push(c);
    expect(chunks.some(c => c.delta === 'hi')).toBe(true);
    const last = chunks[chunks.length - 1];
    expect(last.finishReason).toBe('stop');
    expect(last.usage).toBeDefined();
  });

  it('capabilities: vision for Gemini models', () => {
    const p = new GeminiProvider('id', 'cfg', 'key', undefined, {});
    const caps = p.capabilities('gemini-2.5-pro');
    expect(caps.vision).toBe(true);
    expect(caps.tools).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/providers/gemini.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 GeminiProvider**

`src/main/providers/gemini.ts`：

```ts
import { GoogleGenAI } from '@google/genai';
import type { LLMProvider, ChatRequest, ChatChunk, Model, ChatMessage, ToolCall, ProviderCapabilities } from './types';
import { normalizeError } from './errors';
import { inferCaps } from './caps-heuristics';
import { mergeOverrides, type ProviderParams } from './overrides';

export class GeminiProvider implements LLMProvider {
  public readonly id: string;
  public readonly configId: string;
  private client: GoogleGenAI;
  private parsedParams: ProviderParams;

  constructor(id: string, configId: string, apiKey: string, baseURL?: string, parsedParams: ProviderParams = {}) {
    this.id = id;
    this.configId = configId;
    this.client = new GoogleGenAI({
      apiKey,
      ...(baseURL ? { httpOptions: { baseUrl: baseURL } } : {}),
    });
    this.parsedParams = parsedParams;
  }

  async listModels(): Promise<Model[]> {
    try {
      const pager: any = this.client.models.list as any;
      const list = typeof pager === 'function' ? await pager() : await pager;
      const arr = Array.isArray(list) ? list : (list?.models ?? list?.page ?? []);
      return arr.map((m: any) => {
        const id = (m.name ?? m.id ?? '').replace(/^models\//, '');
        return {
          id,
          name: m.displayName ?? id,
          contextWindow: m.inputTokenLimit ?? 1_000_000,
          caps: inferCaps(id),
        };
      }).filter((m: Model) => !!m.id);
    } catch {
      return [
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1_000_000, caps: inferCaps('gemini-2.5-pro') },
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1_000_000, caps: inferCaps('gemini-2.5-flash') },
        { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', contextWindow: 1_000_000, caps: inferCaps('gemini-2.5-flash-lite') },
      ];
    }
  }

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
    const { headers, body: bodyOverrides } = mergeOverrides(req, this.parsedParams);

    // 翻译：modelOverrides.thinkingBudget → thinkingConfig
    const thinkingCfg = (bodyOverrides as any).thinkingBudget !== undefined
      ? { thinkingBudget: (bodyOverrides as any).thinkingBudget, includeThoughts: true }
      : undefined;
    if (thinkingCfg) delete (bodyOverrides as any).thinkingBudget;

    const generationConfig = {
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens !== undefined ? { maxOutputTokens: req.maxTokens } : {}),
      ...(thinkingCfg ? { thinkingConfig: thinkingCfg } : {}),
      ...stripGenericGeminiFields(bodyOverrides),
    };

    try {
      const chat = this.client.chats.create({
        model: req.model,
        config: {
          ...(req.systemPrompt ? { systemInstruction: req.systemPrompt } : {}),
          ...generationConfig,
          ...(req.tools?.length ? { tools: toGeminiTools(req.tools) } : {}),
        },
        ...(Object.keys(headers).length ? { httpOptions: { headers } } : {}),
      } as any);

      const lastUserMsg = [...req.messages].reverse().find(m => m.role === 'user');
      if (!lastUserMsg) throw new Error('No user message');

      const parts = toGeminiParts(lastUserMsg);
      const stream = await chat.sendMessageStream(
        { message: { role: 'user', parts } } as any,
        { signal } as any,
      );

      let finishReason: ChatChunk['finishReason'] | undefined;
      let usage: ChatChunk['usage'] | undefined;
      const toolCalls: ToolCall[] = [];

      for await (const event of stream as AsyncIterable<any>) {
        const cand = event.candidates?.[0];
        if (cand?.content?.parts) {
          for (const p of cand.content.parts) {
            if (p.text) yield { delta: p.text };
            if ((p as any).thought) yield { reasoningDelta: (p as any).thought };
            if (p.functionCall) {
              toolCalls.push({
                id: p.functionCall.id ?? `call_${toolCalls.length}`,
                name: p.functionCall.name ?? '',
                arguments: p.functionCall.args ?? {},
              });
            }
          }
        }
        if (cand?.finishReason) {
          finishReason = cand.finishReason === 'STOP' ? 'stop'
            : cand.finishReason === 'MAX_TOKENS' ? 'length'
            : cand.finishReason === 'TOOL_CALL' ? 'tool_calls' : 'error';
        }
        if (event.usageMetadata) {
          usage = {
            promptTokens: event.usageMetadata.promptTokenCount ?? 0,
            completionTokens: event.usageMetadata.candidatesTokenCount ?? 0,
          };
        }
      }
      yield {
        ...(finishReason ? { finishReason } : { finishReason: 'stop' }),
        ...(usage ? { usage } : {}),
        ...(toolCalls.length ? { toolCalls } : {}),
      };
    } catch (err) {
      const n = normalizeError(err);
      if (n.code === 'ABORTED') return;
      throw n;
    }
  }

  capabilities(model: string): ProviderCapabilities {
    return {
      vision: /gemini/i.test(model),
      tools: true,
      reasoning: /gemini-2\.5|gemini-3|thinking/i.test(model),
    };
  }
}

function toGeminiParts(msg: ChatMessage): any[] {
  const out: any[] = [];
  if (msg.content) out.push({ text: msg.content });
  if ((msg as any).images?.length) {
    for (const img of (msg as any).images) {
      out.push({
        inlineData: { mimeType: img.mime, data: img.base64 },
      });
    }
  }
  return out;
}

function toGeminiTools(tools: any[]): any[] {
  return [{
    functionDeclarations: tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema ?? { type: 'object', properties: {} },
    })),
  }];
}

function stripGenericGeminiFields(body: Record<string, unknown>): Record<string, unknown> {
  // 仅保留 Gemini generationConfig 合法字段
  const allowed = ['topP', 'topK', 'frequencyPenalty', 'presencePenalty', 'stopSequences'];
  const out: Record<string, unknown> = {};
  for (const k of allowed) {
    if (body[k] !== undefined) {
      // 字段名 camelCase → Gemini 是 camelCase，原样
      out[k] = body[k];
    }
  }
  return out;
}
```

> 实际 SDK API（`chats.create`、`sendMessageStream`）以 `npm install @google/genai` 后的类型为准 — 跑测试时若报错，按 `@google/genai/dist/types/` 的实际类型修正。本步骤保留"开发期间按官方文档写，测试驱动修正"的弹性。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/providers/gemini.test.ts`
Expected: PASS（按需修正实现）

- [ ] **Step 5: Commit**

```bash
git add src/main/providers/gemini.ts tests/unit/providers/gemini.test.ts
git commit -m "feat(providers): add GeminiProvider with @google/genai SDK"
```

---

### Task 3.3: factory 加 gemini case

**Files:**
- Modify: `src/main/providers/factory.ts`

**Steps:**

- [ ] **Step 1: 加 case**

```ts
import { GeminiProvider } from './gemini';

case 'gemini':
  provider = new GeminiProvider(row.id, row.id, apiKey!, row.base_url || undefined, parsed);
  break;
```

- [ ] **Step 2: 跑测试**

Run: `npx vitest run tests/unit tests/integration`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/providers/factory.ts
git commit -m "feat(factory): register gemini type"
```

---

### Task 3.4: provider-router 暴露 gemini

**Files:**
- Modify: `src/main/ipc/routers/provider-router.ts`

**Steps:**

- [ ] **Step 1: 扩展 enum + switch**

```ts
import { GeminiProvider } from '../../providers/gemini';

// zod enum 改：
z.enum(['openai', 'anthropic', 'ollama', 'openai-compat', 'anthropic-messages', 'gemini'])

// switch 加：
case 'gemini':
  provider = new GeminiProvider('__probe__', '__probe__', input.apiKey ?? '', input.baseURL || undefined);
  break;
```

`getConfig` 的 type cast 同步。

- [ ] **Step 2: 跑测试**

Run: `npx vitest run tests/unit tests/integration`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/routers/provider-router.ts
git commit -m "feat(provider-router): expose gemini in all enums"
```

---

### Task 3.5: ProviderForm — type 下拉加 `gemini`

**Files:**
- Modify: `src/renderer/components/ProviderForm.tsx`

**Steps:**

- [ ] **Step 1: 加 type 选项**

```ts
const PROVIDER_TYPES = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'openai-compat', label: 'OpenAI Compatible' },
  { value: 'anthropic-messages', label: 'Anthropic Messages (custom URL)' },
  { value: 'gemini', label: 'Google Gemini' },
];
```

- [ ] **Step 2: type-specific 字段**

```tsx
{type === 'gemini' && (
  <>
    <Field label="API Key" required>
      <input type="password" value={apiKey} onChange={...} />
    </Field>
    <Field label="Base URL (optional, for Vertex AI)">
      <input value={baseURL} onChange={...} placeholder="https://us-central1-aiplatform.googleapis.com" />
    </Field>
    <p className="text-[12px] text-ink-muted mt-1">
      Google AI Studio by default. Set baseURL for Vertex AI endpoints.
    </p>
  </>
)}
```

- [ ] **Step 3: TypeScript + 跑测试**

Run: `npx tsc --noEmit -p tsconfig.json`
Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ProviderForm.tsx
git commit -m "feat(ProviderForm): expose gemini type"
```

---

## Phase 4 — 文档（可选）

### Task 4.1: README 新章节"添加新 Provider"

**Files:**
- Modify: `README.md`（如果存在）或 `docs/providers.md`

**Steps:**

- [ ] **Step 1: 找 README 位置**

Read `README.md` 找相关章节（"Configuration" / "Providers"）。

- [ ] **Step 2: 加章节**

```markdown
## Providers

sidepad supports LLM providers through a layered architecture:

### Built-in providers

| Type | Protocol | Notes |
|---|---|---|
| `openai` | OpenAI Chat Completions | Direct connection |
| `anthropic` | Anthropic Messages | Direct connection |
| `ollama` | Ollama | Local server |
| `openai-compat` | OpenAI Chat Completions | Custom baseURL |
| `anthropic-messages` | Anthropic Messages | Custom baseURL — works with Minimax, self-hosted proxies |
| `gemini` | Gemini generateContent | Direct connection (Google AI Studio or Vertex) |

### Per-model overrides

For each provider, you can set per-model overrides via the **Advanced** section:

- **Extra Headers**: send custom HTTP headers with every request
- **Extra Body**: merge custom fields into the request body (JSON)

Both can be scoped per-model via `modelOverrides` (advanced users edit the JSON directly in the database).

### Adding a new vendor

To add a vendor (e.g. AWS Bedrock Claude), create `src/main/providers/vendors/anthropic-bedrock.ts`:

\`\`\`ts
import { AnthropicBaseProvider } from '../base/anthropic-base';

export class AnthropicBedrockProvider extends AnthropicBaseProvider {
  constructor(id, configId, parsedParams) {
    super(id, configId, '', { baseURL: process.env.BEDROCK_ENDPOINT ?? '' }, parsedParams);
  }
  // override chat() to add SigV4 signing
  async *chat(req, signal) {
    // ... custom logic ...
  }
}
\`\`\`

Then register in `factory.ts` and `provider-router.ts` enum.
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/providers.md 2>/dev/null || git add README.md
git commit -m "docs: provider extensibility guide"
```

---

### Task 4.2: `vendors/.gitkeep` + 扩展约定注释

**Files:**
- Create: `src/main/providers/vendors/.gitkeep`

**Steps:**

- [ ] **Step 1: 创建目录和 JSDoc**

```bash
mkdir -p src/main/providers/vendors
```

`.gitkeep` 内容（或建一个 README.md）：

```markdown
# Vendor Extensions

Each file in this directory implements a vendor-specific provider that
extends one of the protocol base classes in `../base/`.

Conventions:
- File naming: `<protocol>-<vendor>.ts` (e.g. `anthropic-bedrock.ts`)
- Class naming: `<Protocol><Vendor>Provider` (e.g. `AnthropicBedrockProvider`)
- Always `extends` a protocol base class; never modify the base
- Override `chat()` only when you need to intercept the request stream
- Reuse `mergeOverrides()` and `anthropicThinkingParams()` from the base
- Register the new class in `factory.ts` (switch case) and
  `provider-router.ts` (zod enum + switch case)
```

- [ ] **Step 2: Commit**

```bash
git add src/main/providers/vendors/
git commit -m "docs(vendors): add extensibility conventions"
```

---

## 收尾

### Task F: 全量回归 + tsc 检查

**Steps:**

- [ ] **Step 1: 跑所有测试**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 2: TypeScript 严格检查**

Run: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.node.json`
Expected: PASS

- [ ] **Step 3: 手动 sanity 测试**

1. 启动 app（`npm run dev` 或按项目约定）
2. 添加 `openai` provider — 既有流程不变
3. 添加 `openai-compat` 指向 Gemini OpenAI 兼容端点 — 应能 list models
4. 添加 `anthropic-messages` 指向某 baseURL — 应能 chat
5. 添加 `gemini` 直连 — 应能 chat
6. 打开 Advanced 区，填一个 Extra Header 和 Extra Body，提交 — 下次 chat 应包含

- [ ] **Step 4: 更新 CHANGELOG（如果有）**

Run: 看 `CHANGELOG.md` 是否存在；如有，加：

```markdown
## [Unreleased]
### Added
- Per-provider `extraHeaders` and `extraBody` (Advanced section in ProviderForm)
- Per-model overrides via `modelOverrides` in `params_json`
- `anthropic-messages` provider (custom baseURL, any Anthropic Messages-compatible vendor)
- `gemini` native provider via `@google/genai` SDK
- `base/` protocol providers and `vendors/` extension directory (refactor)
```

- [ ] **Step 5: 最终 commit（如有未提交改动）**

```bash
git status
# 若有：
git add -A && git commit -m "chore: final regression sweep"
```