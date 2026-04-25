import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSessionStore } from '../stores/session-store';
import { useChatStore } from '../stores/chat-store';
import { useSettingsStore } from '../stores/settings-store';
import { usePersonaStore, DEFAULT_PERSONA_ID } from '../stores/persona-store';
import { useSkillStore } from '../stores/skill-store';
import { useSessionSkillsStore } from '../stores/session-skills-store';
import { useSessionToolsStore } from '../stores/session-tools-store';
import { useMCPStore } from '../stores/mcp-store';
import { Sidebar } from '../components/Sidebar';
import { MessageBubble } from '../components/MessageBubble';
import { ChatInput } from '../components/ChatInput';
import { PersonaPicker } from '../components/PersonaPicker';
import { Avatar } from '../components/Avatar';
import { IconEditor } from '../components/IconEditor';
import { trpc } from '../lib/trpc-client';

export function ChatPage() {
  const { t } = useTranslation();
  const { sessions, activeSessionId, activeSession: storeActive, loadSessions } = useSessionStore();
  const { sendMessage, stopStreaming, streaming, messages } = useChatStore();
  const { providers } = useSettingsStore();
  const personas = usePersonaStore((s) => s.personas);
  const loadPersonas = usePersonaStore((s) => s.loadPersonas);
  const skills = useSkillStore((s) => s.skills);
  const loadSkills = useSkillStore((s) => s.loadSkills);
  const sessionSkillsByMap = useSessionSkillsStore((s) => s.attached);
  const loadSessionSkills = useSessionSkillsStore((s) => s.load);
  const attachSessionSkill = useSessionSkillsStore((s) => s.attach);
  const detachSessionSkill = useSessionSkillsStore((s) => s.detach);
  const sessionToolsByMap = useSessionToolsStore((s) => s.attached);
  const loadSessionTools = useSessionToolsStore((s) => s.load);
  const attachSessionTool = useSessionToolsStore((s) => s.attach);
  const detachSessionTool = useSessionToolsStore((s) => s.detach);
  const mcpServers = useMCPStore((s) => s.servers);
  const loadMcpServers = useMCPStore((s) => s.loadServers);
  const listMcpTools = useMCPStore((s) => s.listTools);
  const [availableTools, setAvailableTools] = useState<Array<{ name: string; description?: string }>>([]);
  const setParticipantPersona = useSessionStore((s) => s.setParticipantPersona);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [headerPicker, setHeaderPicker] = useState<{
    agentId: string;
    anchor: { top: number; left: number };
  } | null>(null);
  const [skillsPopover, setSkillsPopover] = useState<{
    anchor: { top: number; left: number };
  } | null>(null);
  const [toolsPopover, setToolsPopover] = useState<{
    anchor: { top: number; left: number };
  } | null>(null);
  const [headerIconEdit, setHeaderIconEdit] = useState<{ top: number; left: number } | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const setSessionIcon = useSessionStore((s) => s.setSessionIcon);
  const renameSession = useSessionStore((s) => s.renameSession);

  useEffect(() => {
    loadSessions();
    loadPersonas();
    loadSkills();
    loadMcpServers();
  }, [loadSessions, loadPersonas, loadSkills, loadMcpServers]);

  useEffect(() => {
    if (activeSessionId) {
      loadSessionSkills(activeSessionId);
      loadSessionTools(activeSessionId);
    }
  }, [activeSessionId, loadSessionSkills, loadSessionTools]);

  // Load available tools across enabled MCP servers (union)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const enabled = mcpServers.filter((s) => s.enabled);
      const all: Array<{ name: string; description?: string }> = [];
      const seen = new Set<string>();
      for (const srv of enabled) {
        try {
          const tools = await listMcpTools(srv.id);
          for (const t of tools) {
            if (!seen.has(t.name)) {
              seen.add(t.name);
              all.push({ name: t.name, description: t.description });
            }
          }
        } catch {
          /* skip dead server */
        }
      }
      if (!cancelled) setAvailableTools(all);
    })();
    return () => {
      cancelled = true;
    };
  }, [mcpServers, listMcpTools]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (atBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: streaming ? 'auto' : 'smooth' });
    }
  }, [messages, streaming]);

  const activeSession = storeActive ?? sessions.find((s) => s.id === activeSessionId) ?? null;

  const handleSend = async (text: string, mentions: string[]) => {
    if (!activeSessionId) {
      const session = await useSessionStore.getState().createSession();
      await sendMessage(session.id, text, mentions);
      return;
    }
    await sendMessage(activeSessionId, text, mentions);
  };

  const handleVisibilityChange = async (mode: 'independent' | 'full') => {
    if (!activeSessionId) return;
    await trpc.session.setVisibilityMode.mutate({ sessionId: activeSessionId, mode });
    useSessionStore.getState().selectSession(activeSessionId);
  };

  const handleExport = async () => {
    if (!activeSessionId || !activeSession) return;
    const md = await trpc.session.exportMarkdown.query({ sessionId: activeSessionId });
    const slug = (activeSession.title || 'conversation')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'conversation';
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const filename = `sidepad-${slug}-${ymd}.md`;
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleEditInPlace = async (msgId: string, newContent: string) => {
    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    const updated = messages
      .map((m, i) => (i === idx ? { ...m, content: newContent } : m))
      .slice(0, idx + 1);
    useChatStore.getState().setMessages(updated);
  };

  const handleFork = async (msgId: string, _content: string, title?: string) => {
    if (!activeSessionId) return;
    const forked = await trpc.session.fork.mutate({
      sessionId: activeSessionId,
      parentMessageId: msgId,
      title,
    });
    await useSessionStore.getState().loadSessions();
    await useSessionStore.getState().selectSession(forked.id);
  };

  const providerList = providers.map((p) => ({ id: p.id, configId: p.configId }));

  return (
    <div className="flex h-full">
      <Sidebar />
      <section className="flex-1 flex flex-col bg-paper min-w-0">
        {/* Header */}
        <header className="px-6 h-12 border-b border-rule flex items-center justify-between gap-4 bg-surface">
          <div className="flex items-center gap-2.5 min-w-0 flex-1 group">
            {activeSession && (
              <button
                type="button"
                onClick={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setHeaderIconEdit({ top: rect.bottom + 6, left: rect.left });
                }}
                title={t('chat.changeIcon')}
                className="cursor-pointer hover:opacity-80 transition-opacity"
              >
                <Avatar
                  kind={activeSession.iconKind}
                  value={activeSession.iconValue}
                  name={activeSession.title || activeSession.id}
                  size={22}
                  rounded="md"
                  fallback="empty"
                />
              </button>
            )}
            {editingTitle && activeSession ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={async () => {
                  if (titleDraft.trim() && titleDraft.trim() !== activeSession.title) {
                    await renameSession(activeSession.id, titleDraft.trim());
                    await useSessionStore.getState().refreshActiveSession();
                  }
                  setEditingTitle(false);
                }}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setEditingTitle(false);
                }}
                className="flex-1 bg-transparent border-0 px-0 py-0 text-[14px] font-medium text-ink focus:outline-none"
              />
            ) : (
              <h2
                className="text-[14px] font-medium text-ink truncate cursor-text"
                onDoubleClick={() => {
                  if (!activeSession) return;
                  setTitleDraft(activeSession.title || '');
                  setEditingTitle(true);
                }}
                title={activeSession ? t('chat.renameTitle') : undefined}
              >
                {activeSession?.title || (
                  <span className="text-ink-faint font-normal">{t('chat.newConversation')}</span>
                )}
              </h2>
            )}
            {activeSession && !editingTitle && (
              <span
                onClick={() => {
                  setTitleDraft(activeSession.title || '');
                  setEditingTitle(true);
                }}
                role="button"
                tabIndex={-1}
                aria-label={t('common.rename')}
                title={t('common.rename')}
                className="text-ink-faint hover:text-accent cursor-pointer transition-colors opacity-0 group-hover:opacity-70 hover:!opacity-100"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" />
                </svg>
              </span>
            )}
          </div>
          {activeSession && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                {t('chat.visibility')}
              </span>
              <select
                value={activeSession.visibilityMode}
                onChange={(e) =>
                  handleVisibilityChange(e.target.value as 'independent' | 'full')
                }
                className="bg-surface border border-rule rounded-[6px] text-[12px] text-ink px-2 py-1 cursor-pointer focus:outline-none focus:border-accent"
              >
                <option value="independent">{t('chat.visibilityIndependent')}</option>
                <option value="full">{t('chat.visibilityFull')}</option>
              </select>
              <button
                type="button"
                onClick={handleExport}
                className="text-[12px] text-ink hover:text-accent border border-rule rounded-[6px] px-2 py-1 cursor-pointer transition-colors hover:border-accent"
                title={t('chat.export')}
              >
                {t('chat.export')} ↓
              </button>
            </div>
          )}
        </header>

        {activeSession && activeSession.participants && activeSession.participants.length > 0 && (
          <div className="px-6 py-2 border-b border-rule flex flex-wrap items-center gap-2 bg-surface">
            <span className="text-[11px] uppercase tracking-[0.06em] text-ink-faint">
              {t('chat.voices')}
            </span>
            {activeSession.participants.map((p) => {
              const persona = personas.find((pp) => pp.id === p.personaId);
              const personaLabel =
                p.personaId !== DEFAULT_PERSONA_ID && persona ? ` · ${persona.name}` : '';
              return (
                <button
                  key={p.agentId}
                  type="button"
                  onClick={(e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setHeaderPicker({
                      agentId: p.agentId,
                      anchor: { top: rect.bottom + 6, left: rect.left },
                    });
                  }}
                  className="inline-flex items-center text-[12px] rounded-full bg-surface-2 border border-rule px-2.5 py-0.5 text-ink hover:border-accent hover:text-accent cursor-pointer transition-colors"
                  title={t('chat.changePersona')}
                >
                  <span className="font-medium">@{p.agentId}</span>
                  {personaLabel && (
                    <span className="text-ink-muted ml-1">{personaLabel}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {headerIconEdit && activeSession && (
          <IconEditor
            name={activeSession.title || activeSession.id}
            kind={activeSession.iconKind}
            value={activeSession.iconValue}
            anchor={headerIconEdit}
            onSave={async (k, v) => {
              await setSessionIcon(activeSession.id, k, v);
            }}
            onClose={() => setHeaderIconEdit(null)}
          />
        )}

        {headerPicker && (
          <PersonaPicker
            currentPersonaId={
              activeSession?.participants?.find((p) => p.agentId === headerPicker.agentId)
                ?.personaId ?? DEFAULT_PERSONA_ID
            }
            anchor={headerPicker.anchor}
            onSelect={async (personaId) => {
              await setParticipantPersona(headerPicker.agentId, personaId);
              setHeaderPicker(null);
            }}
            onClose={() => setHeaderPicker(null)}
          />
        )}

        {activeSession && (() => {
          const enabledSkills = skills.filter((s) => s.enabled);
          const attachedIds = new Set(sessionSkillsByMap[activeSession.id] ?? []);
          const visible = enabledSkills.filter((s) => attachedIds.has(s.id));
          return (
            <div className="px-6 py-2 border-b border-rule flex flex-wrap items-center gap-2 bg-surface">
              <span className="text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                {t('chat.skills.title')}
              </span>
              {visible.length === 0 && (
                <span className="text-[12px] text-ink-faint">
                  {t('chat.skills.none')}
                </span>
              )}
              {visible.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center text-[12px] rounded-full bg-accent-muted border border-rule px-2.5 py-0.5 text-accent"
                  title={s.description ?? s.name}
                >
                  {s.name}
                </span>
              ))}
              <button
                type="button"
                onClick={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setSkillsPopover({ anchor: { top: rect.bottom + 6, left: rect.left } });
                }}
                className="inline-flex items-center text-[12px] rounded-full bg-surface-2 border border-rule px-2.5 py-0.5 text-ink hover:border-accent hover:text-accent cursor-pointer transition-colors"
              >
                {t('chat.skills.manage')}
              </button>
            </div>
          );
        })()}

        {skillsPopover && activeSession && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setSkillsPopover(null)}
            />
            <div
              className="fixed z-50 bg-surface border border-rule rounded-[6px] shadow-lg p-2 min-w-[220px]"
              style={{ top: skillsPopover.anchor.top, left: skillsPopover.anchor.left }}
            >
              {skills.filter((s) => s.enabled).length === 0 && (
                <div className="text-[12px] text-ink-faint px-2 py-1">
                  {t('chat.skills.none')}
                </div>
              )}
              {skills
                .filter((s) => s.enabled)
                .map((s) => {
                  const attached = (sessionSkillsByMap[activeSession.id] ?? []).includes(s.id);
                  return (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 px-2 py-1 text-[12px] text-ink hover:bg-surface-2 cursor-pointer rounded"
                    >
                      <input
                        type="checkbox"
                        checked={attached}
                        onChange={async (e) => {
                          if (e.target.checked) {
                            await attachSessionSkill(activeSession.id, s.id);
                          } else {
                            await detachSessionSkill(activeSession.id, s.id);
                          }
                        }}
                      />
                      <span>{s.name}</span>
                    </label>
                  );
                })}
            </div>
          </>
        )}

        {/* Body */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-[760px] mx-auto px-6 pt-6 pb-10">
            {messages.length === 0 && (
              <div className="h-[60vh] flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 rounded-full bg-accent-muted flex items-center justify-center text-accent text-[20px] mb-4">
                  ✦
                </div>
                <p className="text-[14px] text-ink-muted max-w-[42ch]">
                  {t('chat.emptyStart')}{' '}
                  <span className="font-mono text-accent text-[12px] bg-accent-muted px-1.5 py-[1px] rounded-[4px]">@</span>{' '}
                  {t('chat.emptyEnd')}
                </p>
              </div>
            )}
            {messages.map((msg, i) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                index={i}
                onEditInPlace={handleEditInPlace}
                onFork={handleFork}
              />
            ))}
          </div>
        </div>

        <ChatInput
          onSend={handleSend}
          onStop={stopStreaming}
          streaming={streaming}
          disabled={!activeSessionId && sessions.length === 0}
          providers={providerList}
        />
      </section>
    </div>
  );
}
