import type { LLMProvider } from '../providers/types';
import type { ClassifierResult } from './mode-resolver';

export interface ClassifierConfig {
  enabled: boolean;
  providerId: string;
  model: string;
  timeoutMs: number;
  threshold: number;
}

const SYSTEM_PROMPT = `You are a group chat orchestration classifier. Given a user message and a list of @-mentioned agents, output ONLY a JSON object with:
- "mode": one of "lead-and-comment", "parallel", "relay", "roundtable"
- "leadAgentId": the lead agent (only for lead-and-comment)
- "commenterAgentIds": commenter agents (only for lead-and-comment)
- "confidence": a number between 0 and 1`;

export class ClassifierAgent {
  constructor(
    private config: ClassifierConfig,
    private provider: LLMProvider | null,
  ) {}

  isEnabled(): boolean { return this.config.enabled; }

  async classify(input: {
    text: string;
    mentions: Array<{ agentId: string; displayName: string; role: string }>;
    triggerHints: { leadMatched: boolean; commentMatched: boolean };
  }): Promise<ClassifierResult> {
    if (!this.provider || !this.config.enabled) throw new Error('Classifier not configured');

    const prompt = `User message: "${input.text}"\nMentions: ${JSON.stringify(input.mentions)}\nRegex hints: lead=${input.triggerHints.leadMatched}, comment=${input.triggerHints.commentMatched}`;
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), this.config.timeoutMs);

    try {
      let accumulated = '';
      for await (const chunk of this.provider.chat(
        { model: this.config.model, messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ]},
        ac.signal,
      )) {
        if (chunk.delta) accumulated += chunk.delta;
      }
      return parseClassifierJson(accumulated);
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Strip markdown fences / leading prose and parse classifier JSON. */
export function parseClassifierJson(raw: string): ClassifierResult {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  const parsed = JSON.parse(text) as ClassifierResult;
  if (!parsed || typeof parsed.mode !== 'string' || typeof parsed.confidence !== 'number') {
    throw new Error('invalid classifier JSON');
  }
  return parsed;
}
