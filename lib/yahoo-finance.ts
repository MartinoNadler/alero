import type { CedearQuote, HistoricalPoint } from "@/lib/cedear";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const HISTORY_DAYS = 30;

export class CedearLookupError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CedearLookupError";
    this.status = status;
  }
}

interface YahooChartMeta {
  currency: string;
  symbol: string;
  exchangeName: string;
  regularMarketPrice: number;
  previousClose?: number;
  chartPreviousClose: number;
  longName?: string;
  shortName?: string;
}

interface YahooChartResult {
  meta: YahooChartMeta;
  timestamp: number[];
  indicators: {
    quote: Array<{
      open: Array<number | null>;
      high: Array<number | null>;
      low: Array<number | null>;
      close: Array<number | null>;
      volume: Array<number | null>;
    }>;
  };
}

interface YahooChartResponse {
  chart: {
    result: YahooChartResult[] | null;
    error: { code: string; description: string } | null;
  };
}

interface YahooSearchQuote {
  symbol: string;
  quoteType?: string;
}

interface YahooSearchResponse {
  quotes?: YahooSearchQuote[];
}

async function fetchChartResult(symbol: string): Promise<YahooChartResult | null> {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - HISTORY_DAYS * 24 * 60 * 60;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?period1=${period1}&period2=${period2}&interval=1d`;

  let response: Response;
  try {
    response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  } catch {
    throw new CedearLookupError("No se pudo conectar con Yahoo Finance", 502);
  }

  let data: YahooChartResponse;
  try {
    data = await response.json();
  } catch {
    throw new CedearLookupError(
      `Yahoo Finance respondió con el estado ${response.status}`,
      502
    );
  }

  const result = data.chart.result?.[0];
  if (!result || data.chart.error) return null;
  return result;
}

// Entre varias coincidencias, preferimos el símbolo ".BA" (CEDEAR en Buenos
// Aires) más corto: variantes como "GGALD.BA" (segmento dólar) suelen ser
// más largas que el ticker estándar "GGAL.BA".
function pickBestSymbol(quotes: YahooSearchQuote[]): string | null {
  const equities = quotes.filter(
    (q) => q.quoteType === "EQUITY" && typeof q.symbol === "string"
  );
  if (equities.length === 0) return null;

  const cedears = equities.filter((q) => q.symbol.endsWith(".BA"));
  if (cedears.length > 0) {
    return cedears.reduce((shortest, q) =>
      q.symbol.length < shortest.symbol.length ? q : shortest
    ).symbol;
  }

  return equities[0].symbol;
}

async function searchSymbol(query: string): Promise<string | null> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
    query
  )}&quotesCount=10&newsCount=0`;

  let response: Response;
  try {
    response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let data: YahooSearchResponse;
  try {
    data = await response.json();
  } catch {
    return null;
  }

  return pickBestSymbol(data.quotes ?? []);
}

function buildQuote(symbol: string, result: YahooChartResult): CedearQuote {
  const { meta, timestamp, indicators } = result;
  const quote = indicators.quote[0];

  const historical: HistoricalPoint[] = [];
  for (let i = 0; i < timestamp.length; i++) {
    const open = quote.open[i];
    const high = quote.high[i];
    const low = quote.low[i];
    const close = quote.close[i];
    const volume = quote.volume[i];

    if (
      open == null ||
      high == null ||
      low == null ||
      close == null ||
      volume == null
    ) {
      continue;
    }

    historical.push({
      date: new Date(timestamp[i] * 1000).toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume,
    });
  }

  const currentPrice = meta.regularMarketPrice;
  const previousClose = meta.previousClose ?? meta.chartPreviousClose;
  const change = currentPrice - previousClose;
  const changePercent =
    previousClose !== 0 ? (change / previousClose) * 100 : 0;

  return {
    ticker: symbol,
    companyName: meta.longName ?? meta.shortName ?? symbol,
    currency: meta.currency,
    exchangeName: meta.exchangeName,
    currentPrice,
    previousClose,
    change,
    changePercent,
    historical,
  };
}

// Acepta tanto un ticker exacto (ej. "GGAL.BA") como el nombre de una
// empresa (ej. "Galicia"): primero intenta el ticker tal cual, y si no
// hay datos, resuelve el nombre contra el buscador de Yahoo Finance.
export async function fetchCedearQuote(rawQuery: string): Promise<CedearQuote> {
  const trimmed = rawQuery.trim();
  if (!trimmed) {
    throw new CedearLookupError("Ingresá el nombre o código de una empresa", 400);
  }

  const directSymbol = trimmed.toUpperCase();
  let result = await fetchChartResult(directSymbol);
  let symbol = directSymbol;

  if (!result) {
    const resolved = await searchSymbol(trimmed);
    if (!resolved) {
      throw new CedearLookupError(
        `No se encontró ninguna empresa para "${rawQuery}"`,
        404
      );
    }
    symbol = resolved;
    result = await fetchChartResult(symbol);
    if (!result) {
      throw new CedearLookupError(
        `No se encontró ninguna empresa para "${rawQuery}"`,
        404
      );
    }
  }

  return buildQuote(symbol, result);
}
