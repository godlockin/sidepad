import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Heading, Button, Field, Input, TextArea, Select } from '../../components/ui';
import {
  useMCPStore,
  type MCPServer,
  type MCPTransport,
  type AddMCPInput,
  type MCPTool,
} from '../../stores/mcp-store';

export function MCPTab() {
  const { t } = useTranslation();
  const { servers, loadServers, add, setEnabled, remove } = useMCPStore();
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  return (
    <section>
      <Heading level={1} className="mb-2">
        {t('mcpTab.title')}
      </Heading>
      <p className="text-[14px] leading-[1.6] text-ink-muted">{t('mcpTab.body')}</p>

      <div className="mt-6 mb-3 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          {t('mcpTab.library')} · {servers.length.toString().padStart(2, '0')}
        </span>
        {!showNew && (
          <Button variant="ghost" size="sm" onClick={() => setShowNew(true)}>
            {t('mcpTab.newServer')}
          </Button>
        )}
      </div>

      <div className="border border-rule rounded-[10px] bg-surface overflow-hidden">
        {showNew && (
          <div className="p-5 border-b border-rule">
            <MCPForm
              onSubmit={async (input) => {
                await add(input);
                setShowNew(false);
              }}
              onCancel={() => setShowNew(false)}
            />
          </div>
        )}

        {servers.length === 0 && !showNew && (
          <p className="text-[13px] text-ink-faint py-10 text-center">
            {t('mcpTab.empty')}
          </p>
        )}

        {servers.length > 0 && (
          <ol className="divide-y divide-rule">
            {servers.map((s) => (
              <MCPRow
                key={s.id}
                server={s}
                onToggle={(enabled) => setEnabled(s.id, enabled)}
                onDelete={async () => {
                  if (!confirm(t('mcpTab.confirmDelete', { name: s.name }))) return;
                  await remove(s.id);
                }}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

interface MCPRowProps {
  server: MCPServer;
  onToggle: (enabled: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
}

function MCPRow({ server, onToggle, onDelete }: MCPRowProps) {
  const { t } = useTranslation();
  const { listTools } = useMCPStore();
  const [tools, setTools] = useState<MCPTool[] | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!server.enabled) {
      setTools(null);
      setToolsError(null);
      return;
    }
    listTools(server.id)
      .then((list) => {
        if (!cancelled) setTools(list);
      })
      .catch((err) => {
        if (!cancelled) {
          setTools([]);
          setToolsError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [server.id, server.enabled, listTools]);

  const toolCountLabel = !server.enabled
    ? '—'
    : tools === null
    ? '…'
    : tools.length.toString();

  return (
    <li className="px-4 py-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] font-semibold text-ink">{server.name}</span>
          <span className="text-[10px] uppercase tracking-[0.06em] text-ink-faint border border-rule rounded-[4px] px-1.5 py-[1px]">
            {server.transport}
          </span>
          <span
            className="text-[10px] uppercase tracking-[0.06em] text-ink-muted bg-surface-2 border border-rule rounded-[4px] px-1.5 py-[1px]"
            title={toolsError ?? undefined}
          >
            {t('mcpTab.toolsCount', { count: 0, value: toolCountLabel })}
          </span>
          {server.enabled && (
            <span className="text-[10px] uppercase tracking-[0.06em] text-success">
              {t('mcpTab.enabled')}
            </span>
          )}
        </div>
        {toolsError && (
          <p className="mt-1 text-[12px] text-danger leading-[1.55] line-clamp-2">
            {toolsError}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="sm" onClick={() => onToggle(!server.enabled)}>
          {server.enabled ? t('mcpTab.disable') : t('mcpTab.enable')}
        </Button>
        <Button variant="danger" size="sm" onClick={onDelete}>
          {t('mcpTab.delete')}
        </Button>
      </div>
    </li>
  );
}

interface MCPFormProps {
  onSubmit: (input: AddMCPInput) => Promise<void>;
  onCancel: () => void;
}

function MCPForm({ onSubmit, onCancel }: MCPFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<MCPTransport>('stdio');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [url, setUrl] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid =
    name.trim().length > 0 &&
    (transport === 'stdio'
      ? command.trim().length > 0
      : url.trim().length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      let config: Record<string, unknown>;
      if (transport === 'stdio') {
        const args = argsText
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        config = { command: command.trim(), args };
      } else {
        config = { url: url.trim() };
      }
      await onSubmit({
        name: name.trim(),
        transport,
        config,
        enabled,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label={t('mcpForm.nameLabel')}>
        <Input
          autoFocus
          placeholder={t('mcpForm.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label={t('mcpForm.transportLabel')}>
        <Select
          value={transport}
          onChange={(e) => setTransport(e.target.value as MCPTransport)}
        >
          <option value="stdio">{t('mcpForm.transports.stdio')}</option>
          <option value="http">{t('mcpForm.transports.http')}</option>
          <option value="sse">{t('mcpForm.transports.sse')}</option>
        </Select>
      </Field>

      {transport === 'stdio' && (
        <>
          <div className="text-[12px] text-warn border border-warn/40 bg-warn/10 rounded-[6px] px-3 py-2 leading-[1.55]">
            {t('mcpTab.stdioWarning')}
          </div>
          <Field label={t('mcpForm.commandLabel')}>
            <Input
              placeholder={t('mcpForm.commandPlaceholder')}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
          </Field>
          <Field label={t('mcpForm.argsLabel')} hint={t('mcpForm.argsHint')}>
            <TextArea
              rows={4}
              placeholder={t('mcpForm.argsPlaceholder')}
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
            />
          </Field>
        </>
      )}

      {(transport === 'http' || transport === 'sse') && (
        <Field label={t('mcpForm.urlLabel')}>
          <Input
            placeholder={t('mcpForm.urlPlaceholder')}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
      )}

      <label className="flex items-center gap-2 text-[13px] text-ink-muted cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        {t('mcpForm.enableNow')}
      </label>

      {error && <p className="text-[12px] text-danger">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" variant="primary" size="sm" disabled={!valid || submitting}>
          {submitting ? t('mcpForm.saving') : t('mcpForm.save')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('mcpForm.cancel')}
        </Button>
      </div>
    </form>
  );
}
