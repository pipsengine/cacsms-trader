'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, DatabaseZap, Menu, RefreshCw } from 'lucide-react';

import { DashboardPageFrame } from '@/components/dashboard-page-frame';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export type VisualIntelligenceModule =
  | 'overview'
  | 'chart-capture'
  | 'candles'
  | 'swings'
  | 'patterns'
  | 'trendlines'
  | 'channels'
  | 'order-blocks'
  | 'liquidity'
  | 'structure'
  | 'support-resistance';

const analysisApiByModule: Partial<Record<VisualIntelligenceModule, string>> = {
  candles: 'candles',
  swings: 'swings',
  patterns: 'patterns',
  trendlines: 'trendlines',
  channels: 'channels',
  'order-blocks': 'order-blocks',
  liquidity: 'liquidity',
  structure: 'structure',
  'support-resistance': 'support-resistance',
};

interface CaptureRecord {
  id: string;
  symbol: string;
  timeframe: string;
  processingStatus: string;
  capturedAt: string;
  sourcePlatform?: string;
}

export function VisualIntelligenceModulePage(props: {
  title: string;
  description: string;
  module: VisualIntelligenceModule;
}) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [captures, setCaptures] = useState<CaptureRecord[]>([]);
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bridgeOnline, setBridgeOnline] = useState(false);

  const loadCaptures = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/visual-intelligence/captures?limit=50', { cache: 'no-store' });
      const payload = await response.json();
      if (!payload.ok) {
        throw new Error(String(payload.error ?? 'Unable to load chart captures.'));
      }
      const list = Array.isArray(payload.captures) ? payload.captures as CaptureRecord[] : [];
      setCaptures(list);
      setSelectedCaptureId((current) => current ?? list[0]?.id ?? null);
    } catch (loadError) {
      setCaptures([]);
      setSelectedCaptureId(null);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load chart captures.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAnalysis = useCallback(async (captureId: string) => {
    const apiSegment = analysisApiByModule[props.module];
    if (!apiSegment) {
      setAnalysis(null);
      return;
    }

    setAnalysisLoading(true);
    try {
      const response = await fetch(`/api/vision/${apiSegment}/${encodeURIComponent(captureId)}`, { cache: 'no-store' });
      const payload = await response.json();
      setAnalysis(payload.ok ? (payload.analysis ?? payload.result ?? payload) as Record<string, unknown> : null);
    } catch {
      setAnalysis(null);
    } finally {
      setAnalysisLoading(false);
    }
  }, [props.module]);

  useEffect(() => {
    void loadCaptures();
    fetch('/api/mt5/status', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload) => setBridgeOnline(Boolean(payload?.ok && payload?.bridge?.ok)))
      .catch(() => setBridgeOnline(false));
  }, [loadCaptures]);

  useEffect(() => {
    if (selectedCaptureId) {
      void loadAnalysis(selectedCaptureId);
    } else {
      setAnalysis(null);
    }
  }, [selectedCaptureId, loadAnalysis]);

  const selectedCapture = captures.find((capture) => capture.id === selectedCaptureId) ?? null;

  return (
    <DashboardPageFrame bridgeOnline={bridgeOnline} mobileOpen={mobileSidebarOpen} onMobileOpenChange={setMobileSidebarOpen}>
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="border-b border-slate-200 bg-white px-4 py-4 md:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button type="button" className="md:hidden" onClick={() => setMobileSidebarOpen(true)}>
                <Menu className="h-5 w-5 text-slate-700" />
              </button>
              <div>
                <h1 className="text-lg font-semibold text-slate-950">{props.title}</h1>
                <p className="text-sm text-slate-500">{props.description}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadCaptures()} disabled={loading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </div>

        <ScrollArea className="h-[calc(100vh-88px)]">
          <div className="space-y-4 p-4 md:p-6">
            {error ? (
              <Card className="border-amber-200 bg-amber-50">
                <CardContent className="flex items-start gap-3 p-4 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </CardContent>
              </Card>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
              <Card>
                <CardHeader className="py-4">
                  <CardTitle className="text-sm">Chart captures</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 p-4 pt-0">
                  {loading ? (
                    <p className="text-sm text-slate-500">Loading captures...</p>
                  ) : captures.length === 0 ? (
                    <div className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                      <DatabaseZap className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                      <span>No chart captures are available yet. Upload or capture a chart to populate this module.</span>
                    </div>
                  ) : (
                    captures.map((capture) => (
                      <button
                        key={capture.id}
                        type="button"
                        onClick={() => setSelectedCaptureId(capture.id)}
                        className={cn(
                          'w-full rounded-md border px-3 py-2 text-left text-sm transition-colors',
                          selectedCaptureId === capture.id
                            ? 'border-blue-200 bg-blue-50 text-blue-900'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                        )}
                      >
                        <div className="font-medium">{capture.symbol} · {capture.timeframe}</div>
                        <div className="mt-1 text-xs text-slate-500">{capture.processingStatus} · {new Date(capture.capturedAt).toLocaleString()}</div>
                      </button>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="py-4">
                  <CardTitle className="text-sm">Live analysis</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  {!selectedCapture ? (
                    <p className="text-sm text-slate-500">Select a chart capture to inspect stored analysis output.</p>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Metric label="Symbol" value={selectedCapture.symbol} />
                        <Metric label="Timeframe" value={selectedCapture.timeframe} />
                        <Metric label="Status" value={selectedCapture.processingStatus} />
                        <Metric label="Source" value={selectedCapture.sourcePlatform ?? 'unknown'} />
                      </div>

                      {analysisApiByModule[props.module] ? (
                        analysisLoading ? (
                          <p className="text-sm text-slate-500">Loading module analysis...</p>
                        ) : analysis ? (
                          <pre className="max-h-[480px] overflow-auto rounded-md border border-slate-200 bg-slate-950 p-4 text-xs text-slate-100">
                            {JSON.stringify(analysis, null, 2)}
                          </pre>
                        ) : (
                          <p className="text-sm text-slate-500">
                            No stored analysis exists for this capture in {props.title.toLowerCase()}. Run the analyzer from the capture workflow first.
                          </p>
                        )
                      ) : (
                        <pre className="max-h-[480px] overflow-auto rounded-md border border-slate-200 bg-slate-950 p-4 text-xs text-slate-100">
                          {JSON.stringify(selectedCapture, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </ScrollArea>
      </main>
    </DashboardPageFrame>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{props.label}</div>
      <div className="mt-1 font-mono text-sm text-slate-900">{props.value}</div>
    </div>
  );
}
