/**
 * Segment a user message by `@<agent-id>` boundaries for directed sequential relay.
 *
 * The id rule mirrors the upstream extractor used in the renderer
 * (`@(\S+)` followed by trailing-punct trim). Here we accept ids matching
 * /[A-Za-z0-9_-]+/ as the canonical form (alphanumeric + dash + underscore),
 * which is what the orchestrator/mode-resolver already deals in.
 */

export interface MentionSegment {
  agentId: string;
  /** Includes the leading "@id" token and any text up to the next mention. */
  segment: string;
}

export interface SegmentationResult {
  /** Text before the first @mention; "" if the text starts with a mention. */
  prefix: string;
  parts: MentionSegment[];
}

const MENTION_RE = /@([A-Za-z0-9_-]+)/g;

/**
 * Walk `text`, find each `@<id>` boundary, and slice the text from each
 * boundary up to (but not including) the next boundary that matches an id
 * in `orderedMentions` (in appearance order). Mentions in `orderedMentions`
 * that don't actually appear in `text` are silently dropped.
 */
export function segmentByMentions(
  text: string,
  orderedMentions: string[],
): SegmentationResult {
  if (!text) return { prefix: '', parts: [] };
  if (orderedMentions.length === 0) return { prefix: text, parts: [] };

  // Collect every @-token occurrence in order.
  const occurrences: Array<{ id: string; start: number; end: number }> = [];
  MENTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(text)) !== null) {
    occurrences.push({ id: m[1], start: m.index, end: m.index + m[0].length });
  }

  // Pick the first occurrence per agent id, in the order given by
  // `orderedMentions`. Skip mentions that never appear.
  const used = new Set<number>();
  const picks: Array<{ id: string; start: number; end: number }> = [];
  for (const id of orderedMentions) {
    const idx = occurrences.findIndex(
      (o, i) => !used.has(i) && o.id === id,
    );
    if (idx === -1) continue;
    used.add(idx);
    picks.push(occurrences[idx]);
  }

  if (picks.length === 0) return { prefix: text, parts: [] };

  // Sort picks by their position in the text so prefix/segment slicing is
  // monotonic. (orderedMentions should already be in appearance order, but
  // be defensive.)
  picks.sort((a, b) => a.start - b.start);

  const prefix = text.slice(0, picks[0].start).replace(/\s+$/u, '');
  const parts: MentionSegment[] = [];
  for (let i = 0; i < picks.length; i++) {
    const start = picks[i].start;
    const end = i + 1 < picks.length ? picks[i + 1].start : text.length;
    const raw = text.slice(start, end);
    parts.push({ agentId: picks[i].id, segment: raw.trim() });
  }
  return { prefix, parts };
}
