const THEME_KEY = 'itms_theme';

export type AppTheme = 'light' | 'dark';

function resolveStoredTheme(): AppTheme {
  if (typeof window === 'undefined') {
    return 'light';
  }

  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: AppTheme) {
  if (typeof document === 'undefined') {
    return theme;
  }

  document.documentElement.classList.toggle('dark', theme === 'dark');
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(THEME_KEY, theme);
  }
  return theme;
}

export function applyStoredTheme() {
  return applyTheme(resolveStoredTheme());
}

export function toggleStoredTheme() {
  const nextTheme = resolveStoredTheme() === 'dark' ? 'light' : 'dark';
  return applyTheme(nextTheme);
}

export function getStoredTheme() {
  return resolveStoredTheme();
}