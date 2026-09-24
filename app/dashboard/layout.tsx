import type { Metadata } from 'next';
import { Sidebar } from '@/components/navigation/Sidebar';

export const metadata: Metadata = {
  title: 'Research Terminal — Jaro AI',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
