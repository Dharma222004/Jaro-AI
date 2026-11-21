import { Suspense } from 'react';
import { Sidebar } from '@/components/navigation/Sidebar';
import { ResearchAssistant } from '@/components/chat/ResearchAssistant';

export default function RootPage() {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <Suspense fallback={<div className="assistant-loading" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}>Loading Jaro AI...</div>}>
          <ResearchAssistant />
        </Suspense>
      </main>
    </div>
  );
}
