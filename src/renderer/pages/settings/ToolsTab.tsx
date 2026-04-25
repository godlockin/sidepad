import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Heading, Button } from '../../components/ui';
import { trpc } from '../../lib/trpc-client';

type ToolKeyName = 'brave_api_key' | 'tavily_api_key';

interface KeyStatus {
  brave_api_key: { set: boolean };
  tavily_api_key: { set: boolean };
}

export function ToolsTab() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [drafts, setDrafts] = useState<Record<ToolKeyName, string>>({
    brave_api_key: '',
    tavily_api_key: '',
  });
  const [saving, setSaving] = useState<ToolKeyName | null>(null);

  const refresh = async () => {
    const res = (await trpc.settings.getToolKeys.query()) as KeyStatus;
    setStatus(res);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const save = async (key: ToolKeyName) => {
    setSaving(key);
    try {
      await trpc.settings.setToolKey.mutate({ key, value: drafts[key] });
      setDrafts((d) => ({ ...d, [key]: '' }));
      await refresh();
    } finally {
      setSaving(null);
    }
  };

  const rows: { key: ToolKeyName; label: string }[] = [
    { key: 'brave_api_key', label: t('settings.tools.braveKey') },
    { key: 'tavily_api_key', label: t('settings.tools.tavilyKey') },
  ];

  return (
    <section>
      <Heading level={1} className="mb-2">
        {t('settings.tools.title')}
      </Heading>
      <p className="text-[14px] leading-[1.6] text-ink-muted">
        {t('settings.tools.searchHint')}
      </p>

      <div className="mt-6">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          {t('settings.tools.searchBackends')}
        </span>

        <div className="mt-3 border border-rule rounded-[10px] bg-surface overflow-hidden divide-y divide-rule">
          {rows.map((row) => {
            const isSet = !!status?.[row.key]?.set;
            return (
              <div key={row.key} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor={`tools-${row.key}`}
                      className="text-[13px] font-medium text-ink"
                    >
                      {row.label}
                    </label>
                    {isSet && (
                      <span className="text-[10px] uppercase tracking-[0.08em] text-success">
                        ● {t('settings.tools.configured')}
                      </span>
                    )}
                  </div>
                  <input
                    id={`tools-${row.key}`}
                    type="password"
                    autoComplete="off"
                    placeholder={isSet ? '••••••••' : ''}
                    value={drafts[row.key]}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [row.key]: e.target.value }))
                    }
                    className="mt-2 w-full rounded-[6px] border border-rule bg-paper px-2 py-1.5 text-[13px] font-mono text-ink focus:border-accent focus:outline-none"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => save(row.key)}
                  disabled={
                    saving === row.key || drafts[row.key].trim().length === 0
                  }
                >
                  {saving === row.key ? '…' : 'Save'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
