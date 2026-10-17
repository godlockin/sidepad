/** Per-call user approval gate for MCP tool invocations. */

export type ToolApprovalDecision = 'approve' | 'deny';

export type ToolApprovalMode = 'off' | 'ask';

export const TOOL_APPROVAL_SETTING_KEY = 'tool_approval_mode';

export function parseToolApprovalMode(raw: string | undefined | null): ToolApprovalMode {
  return raw === 'ask' ? 'ask' : 'off';
}

export class ToolApprovalGate {
  private pending = new Map<
    string,
    {
      resolve: (d: ToolApprovalDecision) => void;
      reject: (err: Error) => void;
      cleanup: () => void;
    }
  >();

  /**
   * Wait until the UI calls `decide(toolCallId, …)` or the abort signal fires.
   * Keys are tool call ids (unique within a turn).
   */
  request(toolCallId: string, signal: AbortSignal): Promise<ToolApprovalDecision> {
    if (signal.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }
    return new Promise<ToolApprovalDecision>((resolve, reject) => {
      const onAbort = () => {
        const entry = this.pending.get(toolCallId);
        if (!entry) return;
        this.pending.delete(toolCallId);
        entry.cleanup();
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.pending.set(toolCallId, {
        resolve: (d) => {
          this.pending.delete(toolCallId);
          signal.removeEventListener('abort', onAbort);
          resolve(d);
        },
        reject: (err) => {
          this.pending.delete(toolCallId);
          signal.removeEventListener('abort', onAbort);
          reject(err);
        },
        cleanup: () => signal.removeEventListener('abort', onAbort),
      });
    });
  }

  decide(toolCallId: string, decision: ToolApprovalDecision): boolean {
    const entry = this.pending.get(toolCallId);
    if (!entry) return false;
    entry.resolve(decision);
    return true;
  }

  has(toolCallId: string): boolean {
    return this.pending.has(toolCallId);
  }

  /** Reject all waiters (e.g. turn cancelled). */
  clear(reason = 'approval cancelled'): void {
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      entry.cleanup();
      entry.reject(new Error(reason));
    }
  }
}
