import type { PtyApi } from '../../shared/types/pty';

declare global {
  interface Window {
    pty?: PtyApi;
  }
}

export function getPtyApi(): PtyApi | null {
  return typeof window !== 'undefined' && window.pty ? window.pty : null;
}
