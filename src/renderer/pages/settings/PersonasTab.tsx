import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Heading, Button } from '../../components/ui';
import { PersonaForm } from '../../components/PersonaForm';
import {
  usePersonaStore,
  DEFAULT_PERSONA_ID,
  type Persona,
} from '../../stores/persona-store';

export function PersonasTab() {
  const { t } = useTranslation();
  const { personas, loadPersonas, createPersona, updatePersona, deletePersona } =
    usePersonaStore();
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    loadPersonas();
  }, [loadPersonas]);

  return (
    <section>
      <Heading level={1} className="mb-2">
        {t('personasTab.title')}
      </Heading>
      <p className="text-[14px] leading-[1.6] text-ink-muted">
        {t('personasTab.body')}
      </p>

      <div className="mt-6 mb-3 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          {t('personasTab.library')} · {personas.length.toString().padStart(2, '0')}
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
            {t('personasTab.newPersona')}
          </Button>
        )}
      </div>

      <div className="border border-rule rounded-[10px] bg-surface overflow-hidden">
        {showNew && (
          <div className="p-5 border-b border-rule">
            <PersonaForm
              onSubmit={async (input) => {
                await createPersona({ name: input.name, prompt: input.prompt });
                setShowNew(false);
              }}
              onCancel={() => setShowNew(false)}
            />
          </div>
        )}

        {personas.length === 0 && !showNew && (
          <p className="text-[13px] text-ink-faint py-10 text-center">
            {t('personasTab.empty')}
          </p>
        )}

        {personas.length > 0 && (
          <ol className="divide-y divide-rule">
            {personas.map((p) => (
              <PersonaRow
                key={p.id}
                persona={p}
                isEditing={editingId === p.id}
                onEdit={() => {
                  setEditingId(p.id);
                  setShowNew(false);
                }}
                onCancel={() => setEditingId(null)}
                onSave={async (patch) => {
                  await updatePersona(p.id, patch);
                  setEditingId(null);
                }}
                onDelete={async () => {
                  if (p.id === DEFAULT_PERSONA_ID) return;
                  if (!confirm(t('personasTab.confirmDelete', { name: p.name }))) return;
                  await deletePersona(p.id);
                }}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

interface PersonaRowProps {
  persona: Persona;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (patch: { name: string; prompt: string }) => Promise<void>;
  onDelete: () => Promise<void>;
}

function PersonaRow({
  persona,
  isEditing,
  onEdit,
  onCancel,
  onSave,
  onDelete,
}: PersonaRowProps) {
  const { t } = useTranslation();
  const isDefault = persona.id === DEFAULT_PERSONA_ID;

  if (isEditing) {
    return (
      <li className="p-5">
        <PersonaForm
          initial={persona}
          onSubmit={async (input) => {
            await onSave({ name: input.name, prompt: input.prompt });
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
          <span className="text-[14px] font-semibold text-ink">{persona.name}</span>
          {isDefault && (
            <span className="text-[10px] uppercase tracking-[0.06em] text-ink-faint">
              {t('personasTab.default')}
            </span>
          )}
        </div>
        <p className="mt-1 text-[12.5px] text-ink-muted leading-[1.55] line-clamp-2">
          {persona.prompt}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          {t('personasTab.edit')}
        </Button>
        <Button variant="danger" size="sm" disabled={isDefault} onClick={onDelete}>
          {t('personasTab.delete')}
        </Button>
      </div>
    </li>
  );
}
