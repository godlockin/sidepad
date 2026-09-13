import type { MCPCallResult } from './types';

/**
 * Flatten a raw MCP CallToolResult envelope into plain text for the model.
 *
 * The MCP wire format wraps payloads as `content: [{type, text?, ...}]`.
 * Passing that envelope to the model verbatim wastes tokens and confuses
 * smaller models; this extracts the text blocks and summarizes any
 * non-text blocks (images, resources) it cannot represent.
 */
export function flattenMcpResult(result: MCPCallResult | unknown): string {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return result == null ? '' : JSON.stringify(result);
  const content = (result as MCPCallResult).content;
  if (!Array.isArray(content)) return JSON.stringify(result);

  const textParts: string[] = [];
  let nonText = 0;
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text);
    } else {
      nonText++;
    }
  }
  if (nonText > 0) {
    textParts.push(`[${nonText} non-text content block${nonText > 1 ? 's' : ''} omitted]`);
  }
  return textParts.join('\n');
}
