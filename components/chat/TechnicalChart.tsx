'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import { LoaderCircle, Maximize2, Minus, Plus, RotateCcw } from 'lucide-react';
import type { TechnicalAnalysisResult, TechnicalTimeframe } from '@/types/technical';

const TIMEFRAMES: TechnicalTimeframe[] = ['5m', '15m', '30m', '1h', '1d', '1w', '1mo'];

export function TechnicalChart({ initial }: { initial: TechnicalAnalysisResult }) {
  const [result, setResult] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [activeLegend, setActiveLegend] = useState<{
    time?: string;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    volume?: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  // Timeframe change handler
  const changeTimeframe = async (timeframe: TechnicalTimeframe) => {
    if (timeframe === result.timeframe || loading) return;
    setLoading(true);
    try {
      const response = await fetch(
        `/api/market/technical?q=${encodeURIComponent(result.instrument.trading_symbol)}&exchange=${result.instrument.exchange}&timeframe=${timeframe}`,
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load timeframe');
      setResult(data);
    } catch (err) {
      console.warn('Failed to switch timeframe:', err);
    } finally {
      setLoading(false);
    }
  };

  // Convert dates to sorted unique lightweight-charts format
  const chartData = useMemo(() => {
    const rawCandles = result.candles || [];
    const seen = new Set<number>();
    const candles: Array<{ time: Time; open: number; high: number; low: number; close: number; volume: number; isUp: boolean }> = [];

    for (const c of rawCandles) {
      const t = Math.floor(new Date(c.timestamp).getTime() / 1000);
      if (!Number.isFinite(t) || seen.has(t)) continue;
      seen.add(t);
      candles.push({
        time: t as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 0,
        isUp: c.close >= c.open,
      });
    }

    candles.sort((a, b) => (Number(a.time) - Number(b.time)));

    // Indicator series mapping
    const ema20: Array<{ time: Time; value: number }> = [];
    const ema50: Array<{ time: Time; value: number }> = [];
    const bbUpper: Array<{ time: Time; value: number }> = [];
    const bbLower: Array<{ time: Time; value: number }> = [];

    result.series?.ema20?.forEach((pt, idx) => {
      const candle = candles[idx];
      if (candle && pt?.value != null && Number.isFinite(pt.value)) {
        ema20.push({ time: candle.time, value: pt.value });
      }
    });

    result.series?.ema50?.forEach((pt, idx) => {
      const candle = candles[idx];
      if (candle && pt?.value != null && Number.isFinite(pt.value)) {
        ema50.push({ time: candle.time, value: pt.value });
      }
    });

    result.series?.bollingerUpper?.forEach((pt, idx) => {
      const candle = candles[idx];
      if (candle && pt?.value != null && Number.isFinite(pt.value)) {
        bbUpper.push({ time: candle.time, value: pt.value });
      }
    });

    result.series?.bollingerLower?.forEach((pt, idx) => {
      const candle = candles[idx];
      if (candle && pt?.value != null && Number.isFinite(pt.value)) {
        bbLower.push({ time: candle.time, value: pt.value });
      }
    });

    return { candles, ema20, ema50, bbUpper, bbLower };
  }, [result]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clean previous chart instance
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const width = container.clientWidth || 800;
    const height = 380;

    const chart = createChart(container, {
      width,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8ca3ba',
        fontFamily: 'var(--font-varela), "Varela Round", sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.04)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(56, 189, 248, 0.4)',
          width: 1,
          style: 2,
        },
        horzLine: {
          color: 'rgba(56, 189, 248, 0.4)',
          width: 1,
          style: 2,
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        scaleMargins: {
          top: 0.1,
          bottom: 0.22,
        },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    // Add Candlestick Series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    candleSeries.setData(chartData.candles);

    // Volume overlay
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: {
        top: 0.82,
        bottom: 0,
      },
    });

    volumeSeries.setData(
      chartData.candles.map((c) => ({
        time: c.time,
        value: c.volume,
        color: c.isUp ? 'rgba(16, 185, 129, 0.22)' : 'rgba(239, 68, 68, 0.22)',
      })),
    );

    // EMA 20
    if (chartData.ema20.length > 0) {
      const ema20Series = chart.addSeries(LineSeries, {
        color: '#38bdf8',
        lineWidth: 2,
        title: 'EMA 20',
      });
      ema20Series.setData(chartData.ema20);
    }

    // EMA 50
    if (chartData.ema50.length > 0) {
      const ema50Series = chart.addSeries(LineSeries, {
        color: '#f59e0b',
        lineWidth: 2,
        title: 'EMA 50',
      });
      ema50Series.setData(chartData.ema50);
    }

    // Bollinger Bands
    if (chartData.bbUpper.length > 0 && chartData.bbLower.length > 0) {
      const upperSeries = chart.addSeries(LineSeries, {
        color: 'rgba(129, 140, 248, 0.45)',
        lineWidth: 1,
        lineStyle: 2,
        title: 'BB Upper',
      });
      const lowerSeries = chart.addSeries(LineSeries, {
        color: 'rgba(129, 140, 248, 0.45)',
        lineWidth: 1,
        lineStyle: 2,
        title: 'BB Lower',
      });
      upperSeries.setData(chartData.bbUpper);
      lowerSeries.setData(chartData.bbLower);
    }

    // Subscribe to crosshair move for real-time hover stats
    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time || !param.seriesData) {
        setActiveLegend(null);
        return;
      }
      const data = param.seriesData.get(candleSeries) as { open?: number; high?: number; low?: number; close?: number } | undefined;
      const vol = param.seriesData.get(volumeSeries) as { value?: number } | undefined;

      if (data) {
        const dateStr = typeof param.time === 'number'
          ? new Date(param.time * 1000).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : String(param.time);

        setActiveLegend({
          time: dateStr,
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close,
          volume: vol?.value,
        });
      }
    });

    chart.timeScale().fitContent();

    // Resize observer
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries[0] || !chartRef.current) return;
      const { width: newWidth } = entries[0].contentRect;
      if (newWidth > 0) {
        chartRef.current.applyOptions({ width: newWidth });
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [chartData]);

  const fitContent = () => {
    chartRef.current?.timeScale().fitContent();
  };

  const zoomIn = () => {
    const ts = chartRef.current?.timeScale();
    if (!ts) return;
    const range = ts.getVisibleLogicalRange();
    if (range) {
      const span = range.to - range.from;
      ts.setVisibleLogicalRange({ from: range.from + span * 0.15, to: range.to - span * 0.15 });
    }
  };

  const zoomOut = () => {
    const ts = chartRef.current?.timeScale();
    if (!ts) return;
    const range = ts.getVisibleLogicalRange();
    if (range) {
      const span = range.to - range.from;
      ts.setVisibleLogicalRange({ from: range.from - span * 0.15, to: range.to + span * 0.15 });
    }
  };

  const latestCandle = chartData.candles.at(-1);

  return (
    <div className="technical-chart-card">
      {/* Top Toolbar */}
      <div className="technical-chart-toolbar">
        <div className="timeframe-tabs">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              aria-pressed={tf === result.timeframe}
              className={`tf-btn ${tf === result.timeframe ? 'active' : ''}`}
              onClick={() => changeTimeframe(tf)}
              type="button"
            >
              {tf}
            </button>
          ))}
        </div>

        <div className="chart-controls">
          {loading && <LoaderCircle size={14} className="animate-spin text-accent" />}
          <button onClick={zoomIn} title="Zoom in" type="button" aria-label="Zoom in">
            <Plus size={14} />
          </button>
          <button onClick={zoomOut} title="Zoom out" type="button" aria-label="Zoom out">
            <Minus size={14} />
          </button>
          <button onClick={fitContent} title="Fit chart" type="button" aria-label="Fit chart">
            <RotateCcw size={13} />
          </button>
        </div>
      </div>

      {/* Stats Bar & Legend */}
      <div className="chart-stats-bar">
        <div className="chart-ohlc-display">
          {activeLegend ? (
            <>
              <span className="ohlc-item">
                <span className="ohlc-tag">O</span>
                <strong>₹{activeLegend.open?.toFixed(2)}</strong>
              </span>
              <span className="ohlc-item">
                <span className="ohlc-tag">H</span>
                <strong>₹{activeLegend.high?.toFixed(2)}</strong>
              </span>
              <span className="ohlc-item">
                <span className="ohlc-tag">L</span>
                <strong>₹{activeLegend.low?.toFixed(2)}</strong>
              </span>
              <span className="ohlc-item">
                <span className="ohlc-tag">C</span>
                <strong className={activeLegend.close && activeLegend.open && activeLegend.close >= activeLegend.open ? 'text-positive' : 'text-negative'}>
                  ₹{activeLegend.close?.toFixed(2)}
                </strong>
              </span>
              {activeLegend.volume != null && (
                <span className="ohlc-item vol">
                  <span className="ohlc-tag">Vol</span>
                  <strong>{formatVol(activeLegend.volume)}</strong>
                </span>
              )}
            </>
          ) : latestCandle ? (
            <>
              <span className="ohlc-item">
                <span className="ohlc-tag">Last</span>
                <strong className={latestCandle.isUp ? 'text-positive' : 'text-negative'}>
                  ₹{latestCandle.close.toFixed(2)}
                </strong>
              </span>
              <span className="ohlc-item">
                <span className="ohlc-tag">Range</span>
                <strong>₹{latestCandle.low.toFixed(1)} – ₹{latestCandle.high.toFixed(1)}</strong>
              </span>
            </>
          ) : null}
        </div>

        <div className="chart-legend-pills">
          <span className="legend-pill ema20"><i /> EMA 20</span>
          <span className="legend-pill ema50"><i /> EMA 50</span>
          <span className="legend-pill bb"><i /> Bollinger</span>
        </div>
      </div>

      {/* Canvas Mount Container */}
      <div className="chart-canvas-container" ref={containerRef} />
    </div>
  );
}

function formatVol(n: number) {
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)} L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} K`;
  return String(Math.round(n));
}
