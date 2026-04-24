import { create } from 'zustand';
import { trpc } from '../lib/trpc-client';

export const DEFAULT_PERSONA_ID = '_default';

export interface Persona {
  id: string;
  name: string;
  prompt: string;
  createdAt: number;
  updatedAt: number;
}

interface PersonaState {
  personas: Persona[];
  loading: boolean;
  loaded: boolean;

  loadPersonas: () => Promise<void>;
  createPersona: (input: { id?: string; name: string; prompt: string }) => Promise<Persona>;
  updatePersona: (id: string, patch: { name?: string; prompt?: string }) => Promise<Persona>;
  deletePersona: (id: string) => Promise<void>;
  getById: (id: string) => Persona | undefined;
}

export const usePersonaStore = create<PersonaState>((set, get) => ({
  personas: [],
  loading: false,
  loaded: false,

  loadPersonas: async () => {
    set({ loading: true });
    try {
      const personas = (await trpc.persona.list.query()) as Persona[];
      set({ personas, loaded: true });
    } catch {
      set({ personas: [], loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  createPersona: async (input) => {
    const created = (await trpc.persona.create.mutate(input)) as Persona;
    await get().loadPersonas();
    return created;
  },

  updatePersona: async (id, patch) => {
    const updated = (await trpc.persona.update.mutate({ id, ...patch })) as Persona;
    await get().loadPersonas();
    return updated;
  },

  deletePersona: async (id) => {
    if (id === DEFAULT_PERSONA_ID) {
      throw new Error('Cannot delete default persona');
    }
    await trpc.persona.delete.mutate({ id });
    await get().loadPersonas();
  },

  getById: (id) => get().personas.find((p) => p.id === id),
}));
