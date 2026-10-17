export interface PtyApi {
  spawn(opts: {
    id: string;
    chatSessionId: string;
    cols?: number;
    rows?: number;
  }): Promise<{ ok: boolean; pid?: number; shell?: string; error?: string }>;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string): Promise<{ ok: boolean; alreadyDead?: boolean; error?: string }>;
  onData(id: string, cb: (data: string) => void): () => void;
  onExit(id: string, cb: (info: { exitCode: number; signal?: number }) => void): () => void;
}
