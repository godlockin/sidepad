export type Theme = 'system' | 'light' | 'dark';

let mediaQuery: MediaQueryList | null = null;
let currentListener: ((e: MediaQueryListEvent) => void) | null = null;

function resolve(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const resolved = resolve(theme);
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.theme = resolved;

  // Tear down any previous system listener
  if (mediaQuery && currentListener) {
    mediaQuery.removeEventListener('change', currentListener);
    currentListener = null;
  }

  // If system, re-apply on OS change
  if (theme === 'system') {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    currentListener = () => {
      const next = resolve('system');
      root.classList.toggle('dark', next === 'dark');
      root.dataset.theme = next;
    };
    mediaQuery.addEventListener('change', currentListener);
  }
}
