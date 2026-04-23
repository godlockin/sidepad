export type Theme = 'system' | 'light' | 'dark';

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const wantDark = theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', wantDark);
}
