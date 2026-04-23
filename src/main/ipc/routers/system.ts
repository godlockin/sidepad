import { initTRPC } from '@trpc/server';
import { app, safeStorage } from 'electron';

const t = initTRPC.create({ isServer: true });

export const systemRouter = t.router({
  status: t.procedure.query(() => ({
    appVersion: app.getVersion(),
    platform: process.platform,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    dbPath: ((globalThis as any).sidepad?.paths.dbPath ?? null) as string | null,
  })),
});
