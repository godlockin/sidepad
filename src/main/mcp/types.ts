export interface MCPToolDescriptor {
  serverId: string;
  name: string;
  description?: string;
  inputSchema: unknown; // JSON schema
}

export interface MCPCallResult {
  content: Array<{ type: string; text?: string; data?: unknown }>;
  isError?: boolean;
}
