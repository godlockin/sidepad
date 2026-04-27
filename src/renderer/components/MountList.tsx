import React from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../stores/project-store';
import type { MountPoint } from '@main/store/types';

interface Props {
  projectId: string;
}

export function MountList({ projectId }: Props) {
  const { t } = useTranslation();
  const mounts = useProjectStore((s) => s.mounts[projectId] ?? []);
  const removeMount = useProjectStore((s) => s.removeMount);

  if (mounts.length === 0) {
    return <p className="text-[12px] text-ink-3">{t('projects.noMounts')}</p>;
  }
  return (
    <ul className="divide-y divide-border border border-border rounded-md">
      {mounts.map((m: MountPoint) => (
        <li key={m.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
          <span className="px-2 py-0.5 text-[11px] rounded bg-surface-2">
            {t(`projects.roles.${m.role}`)}
          </span>
          <span className="font-mono text-ink-2 truncate flex-1" title={m.path}>
            {m.path}
          </span>
          {m.readOnly && <span className="text-[11px] text-warn">RO</span>}
          <button
            onClick={() => removeMount(m.id, projectId)}
            className="text-ink-3 hover:text-danger text-[12px]"
            aria-label={`remove-mount-${m.id}`}
          >
            {t('projects.delete')}
          </button>
        </li>
      ))}
    </ul>
  );
}
