import { scanLead, scanComment } from './trigger-lexicon';
import type { Participant } from '../store/types';

export interface ModeResult {
  mode: 'single' | 'parallel' | 'relay' | 'lead-and-comment' | 'error';
  agentIds: string[];
  leadAgentId?: string;
  commenterAgentIds?: string[];
  errorCode?: 'NO_DEFAULT_AGENT';
}

export interface ClassifierResult {
  mode: 'lead-and-comment' | 'parallel' | 'relay';
  leadAgentId?: string;
  commenterAgentIds?: string[];
  confidence: number;
}

export function resolveMode(
  session: { defaultAgentId: string | null; groupMode: 'parallel' | 'relay'; participants: Participant[] | string[] },
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

  // 2+ mentions
  if (scanLead(text)) {
    return { mode: 'lead-and-comment', agentIds: mentions, leadAgentId: mentions[0], commenterAgentIds: mentions.slice(1) };
  }
  // Directed sequential relay is now the default for 2+ mentions without
  // a lead trigger. The orchestrator's runRelayInternal segments the text
  // by @<id> boundaries, so each agent sees its own targeted segment plus
  // prior agents' inline replies. session.groupMode is intentionally
  // ignored here — 'parallel' is only reached via classifier override or
  // 0/1-mention paths.
  return { mode: 'relay', agentIds: mentions };
}
