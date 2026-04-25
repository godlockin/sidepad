import type Database from 'better-sqlite3';

interface SkillManifestRow {
  manifest_json: string | null;
}

/**
 * Returns concatenated `system_prompt_addendum` strings for all skills attached
 * to the given session, separated by blank lines. Returns '' if none.
 */
export function getSessionSkillAddenda(db: Database.Database, sessionId: string): string {
  const rows = db
    .prepare(
      `SELECT s.manifest_json
         FROM session_tools st
         JOIN skills s ON s.id = st.ref_id
        WHERE st.session_id = ? AND st.kind = 'skill'
        ORDER BY st.created_at ASC`,
    )
    .all(sessionId) as SkillManifestRow[];

  const parts: string[] = [];
  for (const r of rows) {
    if (!r.manifest_json) continue;
    try {
      const m = JSON.parse(r.manifest_json) as { system_prompt_addendum?: unknown };
      if (typeof m.system_prompt_addendum === 'string' && m.system_prompt_addendum.trim()) {
        parts.push(m.system_prompt_addendum);
      }
    } catch {
      // ignore malformed manifest
    }
  }
  return parts.join('\n\n');
}
