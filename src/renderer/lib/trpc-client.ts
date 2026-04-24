import { createTRPCProxyClient } from '@trpc/client';
import { ipcLink } from 'electron-trpc/renderer';
import type { AppRouter } from '../../main/ipc/trpc';

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [ipcLink()],
});

// Expose on window for e2e tests (Playwright page.evaluate access).
// Harmless in production — same module-level client.
if (typeof window !== 'undefined') {
  (window as any).trpc = trpc;
}
