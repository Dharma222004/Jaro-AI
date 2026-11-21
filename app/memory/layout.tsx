import type { ReactNode } from 'react';
import { Sidebar } from '@/components/navigation/Sidebar';

export default function MemoryLayout({ children }: { children: ReactNode }) {
  return <div className="app-layout"><Sidebar /><main className="main-content">{children}</main></div>;
}
