import { useEffect, useState } from 'react';
export type Theme = 'light' | 'dark' | 'system';
function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('shelf-theme');
      return isTheme(saved) ? saved : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [systemDark, setSystemDark] = useState(
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const changed = () => setSystemDark(media.matches);
    media.addEventListener('change', changed);
    void window.shelfDesktop
      ?.getTheme?.()
      .then((value) => {
        if (isTheme(value)) setTheme(value);
      })
      .catch(() => {});
    return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#171b22' : '#f5f4ef');
    try {
      localStorage.setItem('shelf-theme', theme);
    } catch {}
  }, [theme, resolved]);
  const changeTheme = (value: Theme) => {
    setTheme(value);
    void window.shelfDesktop?.setTheme?.(value).catch(() => {});
  };
  return { theme, resolved, changeTheme };
}
