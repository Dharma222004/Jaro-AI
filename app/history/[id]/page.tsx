'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { ReportView } from '@/components/research/ReportView';
import type { ResearchReport, ResearchSourceMeta } from '@/types/research';

interface ReportData {
  researchId: string;
  status: string;
  company: { name: string; ticker: string; exchange: string };
  report: ResearchReport | null;
  sources: ResearchSourceMeta[];
  error?: string;
  createdAt: string;
}

export default function HistoryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchReport();
  }, [id]);

  const fetchReport = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/research/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load report');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container py-16 text-center">
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading report...</div>
      </div>
    );
  }

  if (error || !data?.report) {
    return (
      <div className="page-container py-16">
        <div className="max-w-lg mx-auto card p-8 text-center">
          <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Could not load report</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
            {error || 'The research report could not be retrieved.'}
          </p>
          <button onClick={() => router.push('/history')} className="btn-secondary">
            <ArrowLeft size={14} /> Back to History
          </button>
        </div>
      </div>
    );
  }

  return (
    <ReportView
      report={data.report}
      sources={data.sources}
      researchId={id}
      onBack={() => router.push('/history')}
      onRefresh={() => router.push('/dashboard')}
    />
  );
}
