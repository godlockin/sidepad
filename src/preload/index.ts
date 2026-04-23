// Note: electron-trpc 0.7.1 (latest stable) only exposes `./main` and `./renderer`
// subpaths. The plan's mandate to import from `electron-trpc/preload` is impossible
// with this version — the official 0.7.x docs use `electron-trpc/main` for both
// processes. Functionally identical at runtime (same exposeElectronTRPC fn).
import { exposeElectronTRPC } from 'electron-trpc/main';

process.once('loaded', () => {
  exposeElectronTRPC();
});
