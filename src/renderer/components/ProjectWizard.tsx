import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../stores/project-store';
import type { MountRole } from '@main/store/types';

interface PendingMount {
  role: MountRole;
  path: string;
  label?: string;
}

interface Props {
  onClose: () => void;
  onCreated?: (id: string) => void;
}

const ROLES: MountRole[] = ['refs', 'inputs', 'workspace', 'outputs', 'scratch'];

export function ProjectWizard({ onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const createProject = useProjectStore((s) => s.createProject);
  const addMount = useProjectStore((s) => s.addMount);
  const [name, setName] = useState('');
  const [pending, setPending] = useState<PendingMount[]>([]);
  const [pickerRole, setPickerRole] = useState<MountRole>('inputs');
  const [busy, setBusy] = useState(false);

  const pickAndAdd = async () => {
    if (!window.cockpit) return;
    const path = await window.cockpit.pickFolder();
    if (!path) return;
    setPending([...pending, { role: pickerRole, path }]);
  };

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const p = await createProject(name.trim());
      for (const m of pending) {
        await addMount(p.id, m.role, m.path, m.label);
      }
      onCreated?.(p.id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="project-wizard"
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    >
      <div className="bg-surface border border-border rounded-lg p-6 w-[480px] space-y-4">
        <h2 className="text-lg font-semibold">{t('projects.newProject')}</h2>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('projects.namePlaceholder')}
          className="w-full border border-border rounded-md px-3 py-2 text-[13px]"
        />
        <div className="space-y-2">
          {pending.map((m, i) => (
            <div key={i} className="flex items-center gap-2 text-[12px]">
              <span className="px-2 py-0.5 rounded bg-surface-2">
                {t(`projects.roles.${m.role}`)}
              </span>
              <span className="text-ink-2 truncate flex-1">{m.path}</span>
              <button
                onClick={() => setPending(pending.filter((_, j) => j !== i))}
                className="text-ink-3 hover:text-danger"
                aria-label={`remove-pending-${i}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={pickerRole}
            onChange={(e) => setPickerRole(e.target.value as MountRole)}
            className="border border-border rounded px-2 py-1 text-[13px]"
            aria-label={t('projects.rolePicker')}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`projects.roles.${r}`)}
              </option>
            ))}
          </select>
          <button
            onClick={pickAndAdd}
            className="px-3 py-1 border border-border rounded text-[13px]"
          >
            {t('projects.pickFolder')}
          </button>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 border border-border rounded text-[13px]"
          >
            {t('projects.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={busy || !name.trim()}
            className="px-3 py-1.5 rounded bg-accent text-white text-[13px] disabled:opacity-50"
          >
            {t('projects.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
