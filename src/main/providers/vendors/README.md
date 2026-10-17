# Vendor Extensions

Each file in this directory implements a vendor-specific provider that
extends one of the protocol base classes in `../base/` (or a protocol
default like `GeminiProvider`).

## Shipped

| Type | Class | Notes |
|------|-------|-------|
| `anthropic-minimax` | `AnthropicMinimaxProvider` | Anthropic Messages → MiniMax (`api.minimax.io/anthropic`) |
| `gemini-vertex` | `GeminiVertexProvider` | Gemini generateContent with required Vertex baseURL |
| `anthropic-bedrock` | `AnthropicBedrockProvider` | Claude via `@anthropic-ai/bedrock-sdk` (SigV4 or bearer) |
| `anthropic-vertex` | `AnthropicVertexProvider` | Claude via `@anthropic-ai/vertex-sdk` (ADC / SA / token) |

## Conventions

- **File naming:** `<protocol>-<vendor>.ts` (e.g. `anthropic-bedrock.ts`)
- **Class naming:** `<Protocol><Vendor>Provider` (e.g. `AnthropicBedrockProvider`)
- Always `extends` a protocol base class; never modify the base
- Override `chat()` only when you need to intercept the request stream
- Reuse `mergeOverrides()` and `anthropicThinkingParams()` from the base
- Register in **three** places: `factory.ts`, `provider-router.ts` (zod enum +
  switches), `ProviderForm.tsx` (+ optional preset in `provider-presets.ts`)
- Add the type to `shared/types/provider-kind.ts`

## Still deferred

_(none — native sqlite-vec packaging remains a separate KB track)_
