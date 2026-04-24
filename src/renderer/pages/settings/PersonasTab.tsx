import React, { useEffect, useState } from 'react';
import { Eyebrow, Heading, Rule, Button } from '../../components/ui';
import { PersonaForm } from '../../components/PersonaForm';
import {
  usePersonaStore,
  DEFAULT_PERSONA_ID,
  type Persona,
} from '../../stores/persona-store';

export function PersonasTab() {
  const { personas, loadPersonas, createPersona, updatePersona, deletePersona } =
    usePersonaStore();
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    loadPersonas();
  }, [loadPersonas]);

  return (
    <section>
      <Eyebrow>Chapter ii · personas</Eyebrow>
      <Heading level={1} className="mt-2 mb-3">
        Voices behind the voice.
      </Heading>
      <p className="font-serif-body text-[15px] leading-[1.7] text-ink-muted max-w-[56ch]">
        A persona is a system prompt — a stance, a temperament. Attach one to
        any voice in a chat to colour its replies. The same model can wear many
        hats.
      </p>

      <div className="mt-8 mb-4 flex items-baseline justify-between">
        <Eyebrow>
          Library · {personas.length.toString().padStart(2, '0')}
        </Eyebrow>
        {!showNew && (
          <button
            onClick={() => {
              setShowNew(true);
              setEditingId(null);
            }}
            className="font-mono text-xxs uppercase tracking-[0.16em] text-ink-faint hover:text-accent cursor-pointer transition-colors"
          >
            + new persona
          </button>
        )}
      </div>
      <Rule />

      {showNew && (
        <PersonaForm
          onSubmit={async (input) => {
            await createPersona({ name: input.name, prompt: input.prompt });
            setShowNew(false);
          }}
          onCancel={() => setShowNew(false)}
        />
      )}

      {personas.length === 0 && !showNew && (
        <p className="font-serif-body italic text-[14px] text-ink-faint py-10 text-center">
          No personas yet.
        </p>
      )}

      {personas.length > 0 && (
        <ol className="divide-y divide-rule">
          {personas.map((p, i) => (
            <PersonaRow
              key={p.id}
              persona={p}
              index={i}
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
                if (!confirm(`Delete persona "${p.name}"?`)) return;
                await deletePersona(p.id);
              }}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

interface PersonaRowProps {
  persona: Persona;
  index: number;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (patch: { name: string; prompt: string }) => Promise<void>;
  onDelete: () => Promise<void>;
}

function PersonaRow({
  persona,
  index,
  isEditing,
  onEdit,
  onCancel,
  onSave,
  onDelete,
}: PersonaRowProps) {
  const isDefault = persona.id === DEFAULT_PERSONA_ID;

  if (isEditing) {
    return (
      <li className="py-2">
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
    <li className="py-4 flex items-baseline gap-4">
      <span className="font-mono text-xxs tabular-nums text-ink-faint pt-[3px]">
        {String(index + 1).padStart(2, '0')}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-3">
          <span
            className="font-display italic text-[18px] text-ink"
            style={{ fontVariationSettings: "'opsz' 36, 'SOFT' 50, 'WONK' 0" }}
          >
            {persona.name}
          </span>
          {isDefault && (
            <span className="font-mono text-xxs uppercase tracking-[0.14em] text-ink-faint">
              · default
            </span>
          )}
        </div>
        <p className="mt-1 font-serif-body text-[13.5px] text-ink-muted leading-[1.6] line-clamp-2 max-w-[60ch]">
          {persona.prompt}
        </p>
      </div>
      <div className="flex items-baseline gap-2 shrink-0">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          edit
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={isDefault}
          onClick={onDelete}
        >
          delete
        </Button>
      </div>
    </li>
  );
}
