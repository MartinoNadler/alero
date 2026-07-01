"use client";

import { useEffect, useRef } from "react";
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

export default function CandleChart({
  historical,
  rate,
}: {
  historical: HistoricalPoint[];
  rate: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);

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
      if (entries[0]) chart.applyOptions({ width: entries[0].contentRect.width });
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

  return <div ref={containerRef} className="w-full" style={{ height: 280 }} />;
}
