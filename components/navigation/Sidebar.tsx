'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Search, BookMarked, Clock, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Research', icon: Search },
  { href: '/watchlist', label: 'Watchlist', icon: BookMarked },
  { href: '/history', label: 'History', icon: Clock },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Desktop Sidebar (Fixed 240px Left Navigation) */}
      <aside className="sidebar-desktop">
        <SidebarContent pathname={pathname} />
      </aside>

      {/* Mobile Top Header (Only visible on screens <= 900px) */}
      <div className="sidebar-mobile-header">
        <Logo />
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ThemeToggle size="sm" />
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="btn-ghost"
            style={{ padding: '0.4rem' }}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.65)',
              backdropFilter: 'blur(4px)',
            }}
            onClick={() => setMobileOpen(false)}
          />
          <aside
            style={{
              position: 'relative',
              zIndex: 10,
              width: '260px',
              height: '100vh',
              background: 'var(--bg-surface)',
              borderRight: '1px solid var(--border-default)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <SidebarContent pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}

function Logo() {
  return (
    <Link
      href="/dashboard"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.6rem',
        textDecoration: 'none',
      }}
    >
      <Image
        src="/logo.png"
        alt="Jaro AI Logo"
        width={36}
        height={36}
        style={{ objectFit: 'contain', flexShrink: 0 }}
        priority
      />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span
          style={{
            fontWeight: 800,
            fontSize: '1rem',
            letterSpacing: '-0.02em',
            color: 'var(--text-primary)',
            lineHeight: 1.1,
          }}
        >
          Jaro <span className="text-gradient-brand">AI</span>
        </span>
        <span
          style={{
            fontSize: '0.62rem',
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Equity Research
        </span>
      </div>
    </Link>
  );
}

function SidebarContent({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        justifyContent: 'space-between',
      }}
    >
      <div>
        {/* Logo Header */}
        <div
          style={{
            padding: '1.25rem 1.15rem',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <Logo />
        </div>

        {/* Navigation Links */}
        <nav style={{ padding: '0.85rem 0.65rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                className={`nav-link ${isActive ? 'active' : ''}`}
              >
                <Icon
                  size={16}
                  strokeWidth={isActive ? 2.5 : 2}
                  style={{
                    color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1 }}>{label}</span>
                {isActive && (
                  <span
                    style={{
                      width: '5px',
                      height: '5px',
                      borderRadius: '50%',
                      background: 'var(--accent)',
                    }}
                  />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer Area with Theme Toggle */}
      <div
        style={{
          padding: '1rem 1rem 4.75rem 1rem',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        <ThemeToggle showLabel />
      </div>
    </div>
  );
}
