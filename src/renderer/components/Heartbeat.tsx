import React, { useEffect, useState } from 'react';
import { trpc } from '../lib/trpc-client';

export function Heartbeat() {
  const [status, setStatus] = useState<{ ok: boolean; appVersion?: string; encryptionAvailable?: boolean; error?: string }>({ ok: false });

  useEffect(() => {
    const tick = async () => {
      try {
        const s = await trpc.system.status.query();
        setStatus({ ok: true, appVersion: s.appVersion, encryptionAvailable: s.encryptionAvailable });
      } catch (e) {
        setStatus({ ok: false, error: String(e) });
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="text-xs text-gray-500">
      {status.ok
        ? `IPC ok · v${status.appVersion} · encryption=${status.encryptionAvailable}`
        : `IPC down: ${status.error ?? 'connecting...'}`}
    </div>
  );
}
