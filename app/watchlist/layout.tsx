import type { Metadata } from 'next';
import { Sidebar } from '@/components/navigation/Sidebar';

export const metadata: Metadata = { title: 'Watchlist — Jaro AI' };

export default function WatchlistLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">{children}</main>
    </div>
  );
}
