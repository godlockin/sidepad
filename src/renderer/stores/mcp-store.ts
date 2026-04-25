import { create } from 'zustand';
import { trpc } from '../lib/trpc-client';

export type MCPTransport = 'stdio' | 'http' | 'sse';

export interface MCPServer {
  id: string;
  name: string;
  transport: MCPTransport;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: number;
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface AddMCPInput {
  name: string;
  transport: MCPTransport;
  config: Record<string, unknown>;
  enabled?: boolean;
}

interface MCPState {
  servers: MCPServer[];
  loading: boolean;
  loaded: boolean;

  loadServers: () => Promise<void>;
  add: (input: AddMCPInput) => Promise<string | null>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  testConnection: (id: string) => Promise<MCPTool[]>;
  listTools: (id: string) => Promise<MCPTool[]>;
}

export const useMCPStore = create<MCPState>((set, get) => ({
  servers: [],
  loading: false,
  loaded: false,

  loadServers: async () => {
    set({ loading: true });
    try {
      const servers = (await trpc.mcp.list.query()) as MCPServer[];
      set({ servers, loaded: true });
    } catch {
      set({ servers: [], loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  add: async (input) => {
    const id = (await trpc.mcp.add.mutate(input)) as string | null;
    await get().loadServers();
    return id;
  },

  setEnabled: async (id, enabled) => {
    await trpc.mcp.setEnabled.mutate({ id, enabled });
    await get().loadServers();
  },

  remove: async (id) => {
    await trpc.mcp.remove.mutate({ id });
    await get().loadServers();
  },

  testConnection: async (id) => {
    return (await trpc.mcp.testConnection.mutate({ id })) as MCPTool[];
  },

  listTools: async (id) => {
    return (await trpc.mcp.listTools.query({ id })) as MCPTool[];
  },
}));
