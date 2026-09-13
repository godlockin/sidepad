/**
 * Renderer-side agent instance id parsing. Mirrors
 * src/main/orchestrator/agent-id.ts — a composite id
 * "provider::persona" addresses one expert instance of a provider.
 */
export const AGENT_ID_SEPARATOR = '::';

export interface ParsedAgentId {
  providerId: string;
  personaId: string | null;
}

export function splitAgentId(agentId: string): ParsedAgentId {
  const idx = agentId.indexOf(AGENT_ID_SEPARATOR);
  if (idx <= 0) return { providerId: agentId, personaId: null };
  const providerId = agentId.slice(0, idx);
  const personaId = agentId.slice(idx + AGENT_ID_SEPARATOR.length);
  return { providerId, personaId: personaId || null };
}
