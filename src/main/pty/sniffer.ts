/** Fallback CLI permission-prompt detector for interactive PTY streams. */

export interface SnifferPattern {
  kind: string;
  re: RegExp;
}

export interface PermissionHit {
  kind: string;
  text: string;
}

export const SNIFFER_PATTERNS: SnifferPattern[] = [
  { kind: 'allow_yn', re: /Allow .+\? \(y\/n\)/i },
  { kind: 'do_you_want', re: /Do you want me to/i },
  { kind: 'approve_action', re: /Approve this (edit|tool|action)/i },
  { kind: 'generic_yn_eol', re: /\[y\/n\]\s*$/i },
  { kind: 'continue_yn', re: /Continue\?\s*\(y\/n\)/i },
  { kind: 'proceed_yn', re: /Proceed with .+\?\s*\(y\/n\)/i },
  { kind: 'numbered_choice', re: /^\s*1\.\s*Yes\b[\s\S]*^\s*2\.\s*No\b/m },
];

export const SNIFFER_BUFFER_MAX = 4096;
export const SNIFFER_DEDUP_MS = 2000;

/** Match the first pattern against a cleaned buffer; returns null if none. */
export function matchPermissionPrompt(buffer: string): PermissionHit | null {
  for (const { kind, re } of SNIFFER_PATTERNS) {
    const m = buffer.match(re);
    if (!m?.[0]?.trim()) continue;
    return { kind, text: m[0].trim() };
  }
  return null;
}

export class PermissionSniffer {
  buffer = '';
  recentHits = new Map<string, number>();

  /** Feed cleaned (ANSI-stripped) chunk; returns a hit to surface, if any. */
  feed(cleanedChunk: string): PermissionHit | null {
    this.buffer = (this.buffer + cleanedChunk).slice(-SNIFFER_BUFFER_MAX);
    const hit = matchPermissionPrompt(this.buffer);
    if (!hit) return null;

    const now = Date.now();
    const last = this.recentHits.get(hit.text);
    if (last && now - last < SNIFFER_DEDUP_MS) return null;
    this.recentHits.set(hit.text, now);
    for (const [k, t] of this.recentHits) {
      if (now - t > SNIFFER_DEDUP_MS * 5) this.recentHits.delete(k);
    }
    this.buffer = '';
    return hit;
  }
}
