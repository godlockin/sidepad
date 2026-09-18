# Vendor Extensions

Each file in this directory implements a vendor-specific provider that
extends one of the protocol base classes in `../base/`.

## Conventions

- **File naming:** `<protocol>-<vendor>.ts` (e.g. `anthropic-bedrock.ts`)
- **Class naming:** `<Protocol><Vendor>Provider` (e.g. `AnthropicBedrockProvider`)
- Always `extends` a protocol base class; never modify the base
- Override `chat()` only when you need to intercept the request stream
- Reuse `mergeOverrides()` and `anthropicThinkingParams()` from the base
- Register the new class in `factory.ts` (switch case) and
  `provider-router.ts` (zod enum + switch case)
