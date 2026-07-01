"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CrosshairMode,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
} from "lightweight-charts";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import type { HistoricalPoint } from "@/lib/cedear";

const UP_COLOR = "#196edc";
const DOWN_COLOR = "#ef4444";

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

interface PeriodOption {
  value: number;
  label: string;
}

export default function CandleChart({
  historical,
  rate,
  periodOptions,
  selectedPeriod,
  onPeriodChange,
  isLoadingPeriod,
}: {
  historical: HistoricalPoint[];
  rate: number;
  periodOptions: PeriodOption[];
  selectedPeriod: number;
  onPeriodChange: (value: number) => void;
  isLoadingPeriod: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#6b7280",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "#ffffff0f" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.08, bottom: 0.28 },
      },
      leftPriceScale: { visible: false },
      timeScale: { borderVisible: false, timeVisible: false },
      width: el.clientWidth,
      height: 280,
    });

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderUpColor: UP_COLOR,
      borderDownColor: DOWN_COLOR,
      wickUpColor: UP_COLOR + "99",
      wickDownColor: DOWN_COLOR + "99",
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      chart.applyOptions({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || !chartRef.current) return;
    if (historical.length === 0) return;

    const candleData = historical.map((p) => ({
      time: p.date as Time,
      open: p.open * rate,
      high: p.high * rate,
      low: p.low * rate,
      close: p.close * rate,
    }));

    const volumeData = historical.map((p) => ({
      time: p.date as Time,
      value: p.volume,
      color: p.close >= p.open ? UP_COLOR + "40" : DOWN_COLOR + "40",
    }));

    candleRef.current.setData(candleData);
    volumeRef.current.setData(volumeData);
    chartRef.current.timeScale().fitContent();
  }, [historical, rate]);

  useEffect(() => {
    if (!isFullscreen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsFullscreen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen]);

  return (
    <div
      className={
        isFullscreen
          ? "fixed inset-0 z-50 flex flex-col bg-background p-4"
          : "relative w-full"
      }
    >
      <button
        type="button"
        onClick={() => setIsFullscreen((v) => !v)}
        aria-label={isFullscreen ? "Cerrar pantalla completa" : "Ver en pantalla completa"}
        className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-background/70 text-muted transition-colors hover:bg-white/10 hover:text-foreground"
      >
        {isFullscreen ? <CloseIcon /> : <ExpandIcon />}
      </button>
      <div className={isFullscreen ? "relative w-full flex-1" : "relative w-full"}>
        {isFullscreen && isLoadingPeriod && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
            <span className="text-xs text-muted">Cargando…</span>
          </div>
        )}
        <div
          ref={containerRef}
          className={isFullscreen ? "h-full w-full" : "w-full"}
          style={isFullscreen ? undefined : { height: 280 }}
        />
      </div>
      {isFullscreen && (
        <div className="mt-2 flex shrink-0 justify-end gap-1">
          {periodOptions.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => onPeriodChange(value)}
              className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
                selectedPeriod === value
                  ? "bg-accent text-white"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
