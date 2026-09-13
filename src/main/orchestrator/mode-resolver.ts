import { scanLead, scanRoundtable } from './trigger-lexicon';
import type { GroupMode, Participant } from '../store/types';

export type OrchestratorMode =
  | 'single'
  | 'parallel'
  | 'relay'
  | 'roundtable'
  | 'lead-and-comment';

export interface ModeResult {
  mode: OrchestratorMode | 'error';
  agentIds: string[];
  leadAgentId?: string;
  commenterAgentIds?: string[];
  errorCode?: 'NO_DEFAULT_AGENT';
}

export interface ClassifierResult {
  mode: 'lead-and-comment' | 'parallel' | 'relay' | 'roundtable';
  leadAgentId?: string;
  commenterAgentIds?: string[];
  confidence: number;
}

export function resolveMode(
  session: { defaultAgentId: string | null; groupMode: GroupMode; participants: Participant[] | string[] },
  text: string,
  mentions: string[],
  classifierResult?: ClassifierResult,
): ModeResult {
  // Classifier: only use if confident
  if (classifierResult && classifierResult.confidence >= 0.6) {
    const cr = classifierResult;
    if (cr.mode === 'lead-and-comment' && cr.leadAgentId)
      return { mode: 'lead-and-comment', agentIds: mentions, leadAgentId: cr.leadAgentId,
        commenterAgentIds: cr.commenterAgentIds ?? mentions.filter(id => id !== cr.leadAgentId) };
    return { mode: cr.mode, agentIds: mentions };
  }

  // 0 mentions
  if (mentions.length === 0) {
    if (session.defaultAgentId) return { mode: 'single', agentIds: [session.defaultAgentId] };
    return { mode: 'error', agentIds: [], errorCode: 'NO_DEFAULT_AGENT' };
  }

  // 1 mention
  if (mentions.length === 1) {
    if (scanLead(text)) {
      const participantIds = (session.participants as Array<Participant | string>).map((p) =>
        typeof p === 'string' ? p : p.agentId,
      );
      const commenters = participantIds.filter((id) => id !== mentions[0]);
      return { mode: 'lead-and-comment', agentIds: mentions, leadAgentId: mentions[0], commenterAgentIds: commenters };
    }
    return { mode: 'single', agentIds: mentions };
  }

  // 2+ mentions. Trigger phrases are most specific; an explicit session
  // collaboration mode (set from the chat header) overrides the heuristic
  // default. 'auto' keeps the directed-sequential-relay default.
  if (scanLead(text)) {
    return { mode: 'lead-and-comment', agentIds: mentions, leadAgentId: mentions[0], commenterAgentIds: mentions.slice(1) };
  }
  if (scanRoundtable(text)) {
    return { mode: 'roundtable', agentIds: mentions };
  }
  switch (session.groupMode) {
    case 'roundtable':
      return { mode: 'roundtable', agentIds: mentions };
    case 'lead-and-comment':
      return { mode: 'lead-and-comment', agentIds: mentions, leadAgentId: mentions[0], commenterAgentIds: mentions.slice(1) };
    case 'parallel':
      return { mode: 'parallel', agentIds: mentions };
    case 'relay':
      return { mode: 'relay', agentIds: mentions };
  }
  // Directed sequential relay is the default for 2+ mentions without a
  // trigger. The orchestrator's runRelayInternal segments the text by
  // @<id> boundaries, so each agent sees its own targeted segment plus
  // prior agents' inline replies.
  return { mode: 'relay', agentIds: mentions };
}
