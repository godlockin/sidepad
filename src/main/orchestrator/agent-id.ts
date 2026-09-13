/**
 * Agent instance ids.
 *
 * An agent id addresses one "expert instance" inside a session. The plain
 * form is a provider id (e.g. "openai-prod"). To run the same provider model
 * under two different expert personas simultaneously, a composite form
 * embeds the persona: "openai-prod::persona-architect".
 *
 * Composite ids are self-describing: persona resolution does not depend on
 * the participant row, and two participants can share the same provider
 * while remaining separately addressable in @-mentions.
 */

export const AGENT_ID_SEPARATOR = '::';

export interface ParsedAgentId {
  providerId: string;
  personaId: string | null;
}

export function parseAgentId(agentId: string): ParsedAgentId {
  const idx = agentId.indexOf(AGENT_ID_SEPARATOR);
  if (idx <= 0) return { providerId: agentId, personaId: null };
  const providerId = agentId.slice(0, idx);
  const personaId = agentId.slice(idx + AGENT_ID_SEPARATOR.length);
  return {
    providerId,
    personaId: personaId || null,
  };
}

export function composeAgentId(providerId: string, personaId?: string | null): string {
  return personaId ? `${providerId}${AGENT_ID_SEPARATOR}${personaId}` : providerId;
}
