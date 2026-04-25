export interface ProviderPreset {
  id: string;
  label: string;
  type: 'openai-compat' | 'openai' | 'anthropic' | 'ollama';
  baseURL?: string;
  hint?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', type: 'openai' },
  { id: 'anthropic', label: 'Anthropic', type: 'anthropic' },
  { id: 'ollama', label: 'Ollama', type: 'ollama', baseURL: 'http://localhost:11434' },
  { id: 'deepseek', label: 'DeepSeek', type: 'openai-compat', baseURL: 'https://api.deepseek.com/v1' },
  { id: 'qwen', label: 'Qwen (DashScope)', type: 'openai-compat', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'glm', label: 'GLM (智谱)', type: 'openai-compat', baseURL: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'moonshot', label: 'Moonshot', type: 'openai-compat', baseURL: 'https://api.moonshot.cn/v1' },
  { id: 'siliconflow', label: 'SiliconFlow', type: 'openai-compat', baseURL: 'https://api.siliconflow.cn/v1' },
  { id: 'together', label: 'Together', type: 'openai-compat', baseURL: 'https://api.together.xyz/v1' },
];
