import React, { useState } from 'react';
import { Field, Input, TextArea, Button } from './ui';
import type { Persona } from '../stores/persona-store';

interface PersonaFormProps {
  initial?: Pick<Persona, 'id' | 'name' | 'prompt'>;
  onSubmit: (input: { id?: string; name: string; prompt: string }) => Promise<void> | void;
  onCancel: () => void;
}

export function PersonaForm({ initial, onSubmit, onCancel }: PersonaFormProps) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim().length > 0 && prompt.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        id: isEdit ? initial!.id : undefined,
        name: name.trim(),
        prompt: prompt.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="py-6 space-y-5">
      <Field label="Name">
        <Input
          autoFocus
          placeholder="e.g. Product Manager"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="System prompt" hint="Sets voice, tone, and constraints for this persona.">
        <TextArea
          rows={6}
          placeholder="You are a senior product manager. Always answer…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </Field>
      {error && <p className="text-xs text-danger font-mono">{error}</p>}
      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" variant="primary" size="sm" disabled={!valid || submitting}>
          {submitting ? 'saving…' : isEdit ? 'save changes' : 'save persona'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          cancel
        </Button>
      </div>
    </form>
  );
}
