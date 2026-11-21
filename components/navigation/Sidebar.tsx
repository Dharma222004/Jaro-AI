'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { BookMarked, BrainCircuit, ChevronLeft, ChevronRight, Clock3, Menu, NotebookTabs, Plus, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { JaroLogo } from '@/components/brand/JaroLogo';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

const NAV_ITEMS = [
  { href: '/', label: 'Research', icon: Search },
  { href: '/watchlist', label: 'Watchlist', icon: BookMarked },
  { href: '/history', label: 'History', icon: Clock3 },
  { href: '/memory', label: 'Memory', icon: BrainCircuit },
  { href: '/journal', label: 'Journal', icon: NotebookTabs },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [collapsePreferenceReady, setCollapsePreferenceReady] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        setCollapsed(localStorage.getItem('jaro_sidebar_collapsed') === 'true');
      } catch {
        setCollapsed(false);
      } finally {
        setCollapsePreferenceReady(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!collapsePreferenceReady) return;
    try {
      localStorage.setItem('jaro_sidebar_collapsed', String(collapsed));
    } catch {
      // The preference is optional when browser storage is unavailable.
    }
  }, [collapsePreferenceReady, collapsed]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawerRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileOpen]);

  return (
    <>
      <aside className={`sidebar-desktop ${collapsed ? 'is-collapsed' : ''}`} aria-label="Primary navigation" id="desktop-primary-navigation">
        <SidebarContent
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
          pathname={pathname}
        />
      </aside>

      <header className="sidebar-mobile-header">
        <Logo mobile />
        <div className="mobile-header-actions">
          <Link href="/?new=1" className="btn-mobile-new" aria-label="New chat" title="Start new conversation">
            <Plus size={15} strokeWidth={2.4} />
            <span>New</span>
          </Link>
          <ThemeToggle size="sm" />
          <button
            aria-controls="mobile-navigation-drawer"
            aria-expanded={mobileOpen}
            aria-label="Open navigation"
            className="mobile-menu-trigger"
            onClick={() => setMobileOpen(true)}
            type="button"
          >
            <Menu size={20} />
          </button>
        </div>
      </header>

      {mobileOpen && (
        <div className="mobile-navigation-layer">
          <button
            aria-label="Close navigation"
            className="mobile-navigation-scrim"
            onClick={() => setMobileOpen(false)}
            type="button"
          />
          <aside
            ref={drawerRef}
            aria-label="Primary navigation"
            aria-modal="true"
            className="mobile-navigation-drawer"
            id="mobile-navigation-drawer"
            role="dialog"
            tabIndex={-1}
          >
            <button
              aria-label="Close navigation"
              className="mobile-drawer-close"
              onClick={() => setMobileOpen(false)}
              type="button"
            >
              <X size={18} />
            </button>
            <SidebarContent pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}

function Logo({ mobile = false, compact = false }: { mobile?: boolean; compact?: boolean; animated?: boolean }) {
  const variant = compact ? 'compact' : mobile ? 'mobile' : 'sidebar';
  return (
    <Link aria-label="Jaro AI home" className="brand-home-link" href="/">
      <JaroLogo variant={variant} />
    </Link>
  );
}

function SidebarContent({
  collapsed = false,
  onNavigate,
  onToggleCollapsed,
  pathname,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
  onToggleCollapsed?: () => void;
  pathname: string;
}) {
  return (
    <div className="sidebar-content">
      <div>
        <div className={`sidebar-brand ${collapsed ? 'is-collapsed' : ''}`}>
          <Logo compact={collapsed} />
          {!collapsed && onToggleCollapsed && (
            <button
              aria-controls="desktop-primary-navigation"
              aria-expanded={true}
              aria-label="Collapse sidebar"
              className="sidebar-collapse-toggle"
              onClick={onToggleCollapsed}
              title="Collapse sidebar"
              type="button"
            >
              <ChevronLeft aria-hidden size={14} />
            </button>
          )}
        </div>

        {collapsed && onToggleCollapsed && (
          <div className="sidebar-expand-row">
            <button
              aria-controls="desktop-primary-navigation"
              aria-expanded={false}
              aria-label="Expand sidebar"
              className="sidebar-expand-toggle"
              onClick={onToggleCollapsed}
              title="Expand sidebar"
              type="button"
            >
              <ChevronRight aria-hidden size={14} />
            </button>
          </div>
        )}

        <nav className="sidebar-nav" aria-label="Workspace">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive = href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                aria-current={isActive ? 'page' : undefined}
                aria-label={label}
                className={`nav-link ${isActive ? 'active' : ''}`}
                href={href}
                key={href}
                onClick={onNavigate}
                title={collapsed ? label : undefined}
              >
                <Icon aria-hidden size={18} strokeWidth={isActive ? 2.25 : 1.9} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="sidebar-footer">
        <ThemeToggle showLabel={!collapsed} />
      </div>
    </div>
  );
}
