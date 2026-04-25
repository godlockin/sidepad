import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Heading, Button, Field, Input, TextArea } from '../../components/ui';
import {
  useSkillStore,
  type Skill,
  type SkillManifest,
} from '../../stores/skill-store';

export function SkillsTab() {
  const { t } = useTranslation();
  const { skills, loadSkills, createSkill, updateSkill, removeSkill, setEnabled } =
    useSkillStore();
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  return (
    <section>
      <Heading level={1} className="mb-2">
        {t('skillsTab.title')}
      </Heading>
      <p className="text-[14px] leading-[1.6] text-ink-muted">{t('skillsTab.body')}</p>

      <div className="mt-6 mb-3 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          {t('skillsTab.library')} · {skills.length.toString().padStart(2, '0')}
        </span>
        {!showNew && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowNew(true);
              setEditingId(null);
            }}
          >
            {t('skillsTab.newSkill')}
          </Button>
        )}
      </div>

      <div className="border border-rule rounded-[10px] bg-surface overflow-hidden">
        {showNew && (
          <div className="p-5 border-b border-rule">
            <SkillForm
              onSubmit={async (input) => {
                await createSkill(input);
                setShowNew(false);
              }}
              onCancel={() => setShowNew(false)}
            />
          </div>
        )}

        {skills.length === 0 && !showNew && (
          <p className="text-[13px] text-ink-faint py-10 text-center">
            {t('skillsTab.empty')}
          </p>
        )}

        {skills.length > 0 && (
          <ol className="divide-y divide-rule">
            {skills.map((s) => (
              <SkillRow
                key={s.id}
                skill={s}
                isEditing={editingId === s.id}
                onEdit={() => {
                  setEditingId(s.id);
                  setShowNew(false);
                }}
                onCancel={() => setEditingId(null)}
                onSave={async (patch) => {
                  await updateSkill(s.id, patch);
                  setEditingId(null);
                }}
                onToggle={async (enabled) => {
                  await setEnabled(s.id, enabled);
                }}
                onDelete={async () => {
                  if (s.source !== 'user') return;
                  if (!confirm(t('skillsTab.confirmDelete', { name: s.name }))) return;
                  await removeSkill(s.id);
                }}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

interface SkillRowProps {
  skill: Skill;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (patch: { manifest: SkillManifest; body?: string }) => Promise<void>;
  onToggle: (enabled: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
}

function SkillRow({
  skill,
  isEditing,
  onEdit,
  onCancel,
  onSave,
  onToggle,
  onDelete,
}: SkillRowProps) {
  const { t } = useTranslation();
  const isBundled = skill.source === 'bundled';

  if (isEditing) {
    return (
      <li className="p-5">
        <SkillForm
          initial={skill}
          onSubmit={async (input) => {
            await onSave({ manifest: input.manifest, body: input.body });
          }}
          onCancel={onCancel}
        />
      </li>
    );
  }

  return (
    <li className="px-4 py-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-ink">{skill.name}</span>
          {isBundled && (
            <span className="text-[10px] uppercase tracking-[0.06em] text-ink-faint">
              {t('skillsTab.bundled')}
            </span>
          )}
          {skill.enabled && (
            <span className="text-[10px] uppercase tracking-[0.06em] text-success">
              {t('skillsTab.enabled')}
            </span>
          )}
        </div>
        {skill.description && (
          <p className="mt-1 text-[12.5px] text-ink-muted leading-[1.55] line-clamp-2">
            {skill.description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="sm" onClick={() => onToggle(!skill.enabled)}>
          {skill.enabled ? t('skillsTab.disable') : t('skillsTab.enable')}
        </Button>
        {!isBundled && (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            {t('skillsTab.edit')}
          </Button>
        )}
        <Button variant="danger" size="sm" disabled={isBundled} onClick={onDelete}>
          {t('skillsTab.delete')}
        </Button>
      </div>
    </li>
  );
}

interface SkillFormProps {
  initial?: Skill;
  onSubmit: (input: {
    slug?: string;
    manifest: SkillManifest;
    body?: string;
  }) => Promise<void>;
  onCancel: () => void;
}

function SkillForm({ initial, onSubmit, onCancel }: SkillFormProps) {
  const { t } = useTranslation();
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.manifest.name ?? '');
  const [description, setDescription] = useState(initial?.manifest.description ?? '');
  const [addendum, setAddendum] = useState(
    initial?.manifest.system_prompt_addendum ?? '',
  );
  const [tools, setTools] = useState(
    (initial?.manifest.recommended_tools ?? []).join(', '),
  );
  const [body, setBody] = useState(initial?.body ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const recommended = tools
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const manifest: SkillManifest = {
        name: name.trim(),
        description: description.trim() || undefined,
        system_prompt_addendum: addendum.trim() || undefined,
        recommended_tools: recommended.length > 0 ? recommended : undefined,
      };
      await onSubmit({ manifest, body, slug: isEdit ? undefined : undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label={t('skillForm.nameLabel')}>
        <Input
          autoFocus
          placeholder={t('skillForm.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label={t('skillForm.descriptionLabel')}>
        <Input
          placeholder={t('skillForm.descriptionPlaceholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Field
        label={t('skillForm.addendumLabel')}
        hint={t('skillForm.addendumHint')}
      >
        <TextArea
          rows={5}
          placeholder={t('skillForm.addendumPlaceholder')}
          value={addendum}
          onChange={(e) => setAddendum(e.target.value)}
        />
      </Field>
      <Field
        label={t('skillForm.toolsLabel')}
        hint={t('skillForm.toolsHint')}
      >
        <Input
          placeholder={t('skillForm.toolsPlaceholder')}
          value={tools}
          onChange={(e) => setTools(e.target.value)}
        />
      </Field>
      <Field label={t('skillForm.bodyLabel')} hint={t('skillForm.bodyHint')}>
        <TextArea
          rows={4}
          placeholder={t('skillForm.bodyPlaceholder')}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </Field>
      {error && <p className="text-[12px] text-danger">{error}</p>}
      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" variant="primary" size="sm" disabled={!valid || submitting}>
          {submitting
            ? t('skillForm.saving')
            : isEdit
            ? t('skillForm.saveChanges')
            : t('skillForm.saveSkill')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('skillForm.cancel')}
        </Button>
      </div>
    </form>
  );
}
