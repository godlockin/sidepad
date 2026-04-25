import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { openSidepadDb } from '@main/store/db';
import { getSessionSkillAddenda } from '@main/skills/composer';
import { createSessionToolsStore } from '@main/store/session-tools-store';
import { ChatOrchestrator } from '@main/orchestrator';
import type { SessionStore } from '@main/store/session-store';
import type { ProviderRegistry } from '@main/providers';
import type { LLMProvider, ChatRequest } from '@main/providers/types';
import type { Session } from '@main/store/types';

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-skill-prompt-'));
  dbPath = path.join(tmpDir, 'sidepad.db');
});

afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function insertSkill(
  db: ReturnType<typeof openSidepadDb>,
  id: string,
  name: string,
  addendum: string,
) {
  const manifest = JSON.stringify({ name, system_prompt_addendum: addendum });
  db.prepare(
    'INSERT INTO skills (id,name,description,manifest_json,source,enabled,created_at) VALUES (?,?,?,?,?,?,?)',
  ).run(id, name, null, manifest, 'user', 1, Date.now());
}

describe('getSessionSkillAddenda', () => {
  it('returns concatenated addenda for attached skills', () => {
    const db = openSidepadDb(dbPath);
    insertSkill(db, 'user:rules', 'Rules', 'EXTRA RULES');
    insertSkill(db, 'user:other', 'Other', 'OTHER ADDENDUM');
    insertSkill(db, 'user:notattached', 'Not', 'SHOULD NOT APPEAR');

    const tools = createSessionToolsStore(db);
    tools.attach('session-x', 'skill', 'user:rules');
    tools.attach('session-x', 'skill', 'user:other');

    const composed = getSessionSkillAddenda(db, 'session-x');
    expect(composed).toContain('EXTRA RULES');
    expect(composed).toContain('OTHER ADDENDUM');
    expect(composed).not.toContain('SHOULD NOT APPEAR');
  });

  it('returns empty string when no skills attached', () => {
    const db = openSidepadDb(dbPath);
    expect(getSessionSkillAddenda(db, 'no-such-session')).toBe('');
  });
});

describe('ChatOrchestrator composes skill addenda into system prompt', () => {
  it('passes EXTRA RULES into the provider system prompt', async () => {
    const db = openSidepadDb(dbPath);
    insertSkill(db, 'user:r', 'Rules', 'EXTRA RULES');
    createSessionToolsStore(db).attach('session-1', 'skill', 'user:r');

    const session: Session = {
      id: 'session-1',
      title: 'T',
      createdAt: 1,
      updatedAt: 1,
      systemPrompt: null,
      visibilityMode: 'independent',
      groupMode: 'parallel',
      defaultAgentId: 'agent-a',
      participants: [{ agentId: 'agent-a', personaId: 'default' }],
      folderId: null,
      projectId: null,
      pinned: false,
      archived: false,
      parentMessageId: null,
    } as unknown as Session;

    const store = {
      getSession: (id: string) => (id === 'session-1' ? session : null),
      appendUserMessage: () => ({}),
      startAssistantMessage: (_s: string, _t: string, agentId: string) => ({
        id: `msg-${agentId}`,
      }),
      appendDelta: () => undefined,
      finalizeAssistant: () => undefined,
      markError: () => undefined,
    } as unknown as SessionStore;

    const captured: ChatRequest[] = [];
    const provider: LLMProvider = {
      id: 'openai',
      configId: 'config-openai',
      listModels: async () => [],
      async *chat(req: ChatRequest, _signal: AbortSignal) {
        captured.push(req);
        yield { delta: 'ok', finishReason: 'stop' as const };
      },
    } as unknown as LLMProvider;

    const registry = {
      list: () => [provider],
      get: () => provider,
      has: () => true,
      register: () => undefined,
      unregister: () => undefined,
      onProviderChanged: () => undefined,
    } as unknown as ProviderRegistry;

    const orch = new ChatOrchestrator(
      store,
      registry,
      null,
      () => provider,
      () => 'gpt-4o-mini',
      () => null,
      (sid: string) => getSessionSkillAddenda(db, sid),
    );

    for await (const _ev of orch.send(
      { sessionId: 'session-1', text: 'hi', mentions: ['agent-a'] },
      new AbortController().signal,
    )) {
      // drain
    }

    expect(captured.length).toBeGreaterThan(0);
    const sys = captured[0].messages.find((m) => m.role === 'system');
    expect(sys?.content).toContain('EXTRA RULES');
  });
});
