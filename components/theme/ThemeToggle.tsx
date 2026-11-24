'use client';

import { useCallback, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export type ThemeMode = 'dark' | 'light';

function applyTheme(next: ThemeMode) {
  document.documentElement.setAttribute('data-theme', next);
  document.documentElement.classList.toggle('dark', next === 'dark');
  document.documentElement.classList.toggle('light', next === 'light');
  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.toggle('dark', next === 'dark');
    document.body.classList.toggle('light', next === 'light');
  }
  try { localStorage.setItem('jaro_theme', next); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('jaro-theme-change', { detail: next }));
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let stored: ThemeMode = 'dark';
    try {
      const raw = localStorage.getItem('jaro_theme');
      if (raw === 'dark' || raw === 'light') {
        stored = raw;
      } else {
        const docTheme = document.documentElement.getAttribute('data-theme');
        if (docTheme === 'dark' || docTheme === 'light') stored = docTheme;
      }
    } catch { /* ignore */ }
    queueMicrotask(() => {
      if (cancelled) return;
      setMounted(true);
      setThemeState(stored);
      applyTheme(stored);
    });

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'jaro_theme' && (event.newValue === 'dark' || event.newValue === 'light')) {
        setThemeState(event.newValue);
        applyTheme(event.newValue);
      }
    };
    const handleCustomChange = (event: Event) => {
      const change = event as CustomEvent<ThemeMode>;
      if (change.detail === 'dark' || change.detail === 'light') setThemeState(change.detail);
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('jaro-theme-change', handleCustomChange);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('jaro-theme-change', handleCustomChange);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setThemeState(next);
    applyTheme(next);
  }, [theme]);

  const setTheme = useCallback((target: ThemeMode) => {
    setThemeState(target);
    applyTheme(target);
  }, []);

  return { theme, toggleTheme, setTheme, mounted };
}

interface ThemeToggleProps {
  showLabel?: boolean;
  className?: string;
  size?: 'sm' | 'md';
}

export function ThemeToggle({ showLabel = false, className = '', size = 'md' }: ThemeToggleProps) {
  const { theme, toggleTheme, mounted } = useTheme();

  if (!mounted) {
    return <span aria-hidden className={`theme-toggle-skeleton ${showLabel ? 'labelled' : size}`} />;
  }

  const isDark = theme === 'dark';
  const label = `Switch to ${isDark ? 'light' : 'dark'} mode`;

  if (showLabel) {
    return (
      <button
        aria-checked={isDark}
        className={`theme-toggle theme-toggle-labelled ${className}`.trim()}
        onClick={toggleTheme}
        role="switch"
        title={label}
        type="button"
      >
        <span className="theme-toggle-copy">
          {isDark ? <Moon aria-hidden size={17} /> : <Sun aria-hidden size={17} />}
          <span>{isDark ? 'Dark mode' : 'Light mode'}</span>
        </span>
        <span aria-hidden className={`theme-switch-track ${isDark ? 'active' : ''}`}>
          <span />
        </span>
      </button>
    );
  }

  return (
    <button
      aria-label={label}
      className={`theme-toggle theme-toggle-icon ${size} ${className}`.trim()}
      onClick={toggleTheme}
      title={label}
      type="button"
    >
      {isDark ? <Sun aria-hidden size={size === 'sm' ? 17 : 18} /> : <Moon aria-hidden size={size === 'sm' ? 17 : 18} />}
    </button>
  );
}
