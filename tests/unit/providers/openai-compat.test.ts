import { describe, it, expect } from 'vitest';
import { OpenAICompatProvider } from '../../../src/main/providers/openai-compat';

describe('OpenAICompatProvider', () => {
  it('extends OpenAIProvider with baseURL', () => {
    const p = new OpenAICompatProvider('glm', 'cfg-glm', 'sk-test', 'https://open.bigmodel.cn/api/paas/v4');
    expect(p.id).toBe('glm');
    expect(p.configId).toBe('cfg-glm');
  });
});
