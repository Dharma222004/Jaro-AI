'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BookMarked, BrainCircuit, ChevronLeft, ChevronRight, Clock3, Menu, MessageSquarePlus, NotebookTabs, Plus, Search, X } from 'lucide-react';
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
  const router = useRouter();
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

  const handleMobileNewChat = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('jaro-new-chat'));
    }
    if (pathname !== '/') {
      router.push('/?new=1');
    }
  };

  return (
    <>
      <aside className={`sidebar-desktop ${collapsed ? 'is-collapsed' : ''}`} aria-label="Primary navigation" id="desktop-primary-navigation">
        <SidebarContent
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
          pathname={pathname}
        />
      </aside>

      <header className="sidebar-mobile-header" role="banner">
        <div className="mobile-brand-container">
          <Link aria-label="Jaro AI home" className="brand-home-link" href="/">
            <JaroLogo variant="mobile" />
          </Link>
        </div>
        <div className="mobile-header-actions">
          <button
            onClick={handleMobileNewChat}
            className="btn-mobile-new"
            aria-label="New chat"
            title="New chat"
            type="button"
          >
            <MessageSquarePlus size={18} strokeWidth={2.2} />
          </button>
          <ThemeToggle size="sm" />
          <button
            aria-controls="mobile-navigation-drawer"
            aria-expanded={mobileOpen}
            aria-label="Open navigation menu"
            className="mobile-menu-trigger"
            onClick={() => setMobileOpen(true)}
            type="button"
          >
            <Menu size={18} />
          </button>
        </div>
      </header>

      {mobileOpen && (
        <div className="mobile-navigation-layer">
          <button
            aria-label="Close navigation menu"
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
            <div className="mobile-drawer-header">
              <JaroLogo variant="compact" />
              <button
                aria-label="Close navigation"
                className="mobile-drawer-close"
                onClick={() => setMobileOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            </div>
            <SidebarContent pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
    </>
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
          <Link aria-label="Jaro AI home" className="brand-home-link" href="/">
            <JaroLogo variant={collapsed ? 'compact' : 'sidebar'} />
          </Link>
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
