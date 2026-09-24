'use client';

import { useEffect, useState, useCallback } from 'react';
import { Sun, Moon } from 'lucide-react';

export type ThemeMode = 'dark' | 'light';

function applyTheme(next: ThemeMode) {
  document.documentElement.setAttribute('data-theme', next);
  if (next === 'dark') {
    document.documentElement.classList.add('dark');
    document.documentElement.classList.remove('light');
  } else {
    document.documentElement.classList.add('light');
    document.documentElement.classList.remove('dark');
  }
  try { localStorage.setItem('jaro_theme', next); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('jaro-theme-change', { detail: next }));
}

export function useTheme() {
  // Default to dark — the design palette is dark-first
  const [theme, setThemeState] = useState<ThemeMode>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Read stored preference; fall back to dark
    let stored: ThemeMode = 'dark';
    try {
      const raw = localStorage.getItem('jaro_theme');
      if (raw === 'dark' || raw === 'light') stored = raw;
    } catch { /* ignore */ }
    setThemeState(stored);
    applyTheme(stored);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'jaro_theme' && (e.newValue === 'dark' || e.newValue === 'light')) {
        setThemeState(e.newValue);
        applyTheme(e.newValue);
      }
    };
    const handleCustomChange = (e: Event) => {
      const ce = e as CustomEvent<ThemeMode>;
      if (ce.detail === 'dark' || ce.detail === 'light') setThemeState(ce.detail);
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('jaro-theme-change', handleCustomChange);
    return () => {
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

  // Render a skeleton while JS hasn't mounted to avoid flash
  if (!mounted) {
    return (
      <div
        style={{
          width: showLabel ? '100%' : size === 'sm' ? '2rem' : '2.25rem',
          height: showLabel ? '2.4rem' : size === 'sm' ? '2rem' : '2.25rem',
          borderRadius: '8px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
        }}
      />
    );
  }

  const isDark = theme === 'dark';

  /* ── Label variant (sidebar / settings) ── */
  if (showLabel) {
    return (
      <button
        onClick={toggleTheme}
        type="button"
        className={className}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '0.6rem 0.85rem',
          borderRadius: '8px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
          cursor: 'pointer',
          boxSizing: 'border-box',
          outline: 'none',
          transition: 'all 0.15s ease',
        }}
        aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        title={`Click to switch to ${isDark ? 'Light' : 'Dark'} mode`}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', lineHeight: 1 }}>
          {isDark
            ? <Moon size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            : <Sun  size={14} style={{ color: '#f59e0b',       flexShrink: 0 }} />
          }
          <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.82rem', whiteSpace: 'nowrap', fontFamily: 'var(--font-sans)' }}>
            {isDark ? 'Dark Mode' : 'Light Mode'}
          </span>
        </span>

        {/* Toggle pill */}
        <div style={{ width: '32px', height: '18px', borderRadius: '999px', background: isDark ? 'var(--accent)' : 'var(--border-strong)', position: 'relative', flexShrink: 0, transition: 'background-color 0.2s' }}>
          <div style={{ width: '14px', height: '14px', borderRadius: '50%', background: '#ffffff', position: 'absolute', top: '2px', left: isDark ? '16px' : '2px', transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }} />
        </div>
      </button>
    );
  }

  /* ── Icon-only variant (header) ── */
  return (
    <button
      onClick={toggleTheme}
      type="button"
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size === 'sm' ? '2rem' : '2.25rem',
        height: size === 'sm' ? '2rem' : '2.25rem',
        borderRadius: '8px',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        boxSizing: 'border-box',
        transition: 'all 0.15s ease',
      }}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      title={`Switch to ${isDark ? 'Light' : 'Dark'} mode`}
    >
      {isDark
        ? <Sun  size={size === 'sm' ? 14 : 16} style={{ color: '#fbbf24' }} />
        : <Moon size={size === 'sm' ? 14 : 16} style={{ color: '#3b82f6' }} />
      }
    </button>
  );
}
