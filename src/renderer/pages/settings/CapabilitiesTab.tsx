import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Heading } from '../../components/ui';
import { SkillsTab } from './SkillsTab';
import { MCPTab } from './MCPTab';

type Filter = 'all' | 'skills' | 'tools';

export function CapabilitiesTab() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('all');

  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: t('settings.capabilities.filterAll') },
    { key: 'skills', label: t('settings.capabilities.filterSkills') },
    { key: 'tools', label: t('settings.capabilities.filterTools') },
  ];

  const showSkills = filter === 'all' || filter === 'skills';
  const showTools = filter === 'all' || filter === 'tools';

  return (
    <section>
      <Heading level={1} className="mb-2">
        {t('settings.capabilities.title')}
      </Heading>
      <p className="text-[14px] leading-[1.6] text-ink-muted">
        {t('settings.capabilities.body')}
      </p>

      <div className="mt-5 mb-2 flex items-center gap-2">
        {chips.map((c) => {
          const active = filter === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setFilter(c.key)}
              aria-pressed={active}
              className={`px-3 py-1 rounded-full text-[12px] font-medium border cursor-pointer transition-colors duration-[var(--dur-fast)] ${
                active
                  ? 'bg-accent-muted text-accent border-accent'
                  : 'text-ink-muted border-rule hover:text-ink hover:bg-surface'
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div className="space-y-8 mt-4">
        {showSkills && (
          <div>
            <SkillsTab />
          </div>
        )}
        {showTools && (
          <div>
            <MCPTab />
          </div>
        )}
      </div>
    </section>
  );
}
