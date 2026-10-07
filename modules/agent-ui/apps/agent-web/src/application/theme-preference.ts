import { useEffect, useState } from 'react';

export type ApplicationTheme = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'ta-ui-agent-web-theme';
function readTheme(): ApplicationTheme {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}
export function useApplicationTheme() {
  const [theme, setTheme] = useState<ApplicationTheme>(readTheme);
  useEffect(() => {
    const previous = document.documentElement.getAttribute('data-ta-ui-theme');
    document.documentElement.setAttribute('data-ta-ui-theme', theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* Storage may be unavailable; theme still works. */
    }
    return () => {
      if (previous === null) document.documentElement.removeAttribute('data-ta-ui-theme');
      else document.documentElement.setAttribute('data-ta-ui-theme', previous);
    };
  }, [theme]);
  return { theme, setTheme };
}
