import type { CedearQuote, HistoricalPoint } from "@/lib/cedear";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const HISTORY_DAYS = 30;

export const VALID_PERIODS = [30, 90, 365, 1825] as const;
export type HistoryDays = (typeof VALID_PERIODS)[number];

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

async function fetchChartResult(symbol: string, days: number = HISTORY_DAYS): Promise<YahooChartResult | null> {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - days * 24 * 60 * 60;
  const interval = days > 365 ? "1mo" : days > 90 ? "1wk" : "1d";

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?period1=${period1}&period2=${period2}&interval=${interval}`;

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

function buildHistorical(result: YahooChartResult): HistoricalPoint[] {
  const { timestamp, indicators } = result;
  const quote = indicators.quote[0];
  const historical: HistoricalPoint[] = [];

  for (let i = 0; i < timestamp.length; i++) {
    const open = quote.open[i];
    const high = quote.high[i];
    const low = quote.low[i];
    const close = quote.close[i];
    const volume = quote.volume[i];
    if (open == null || high == null || low == null || close == null || volume == null) continue;
    historical.push({
      date: new Date(timestamp[i] * 1000).toISOString().slice(0, 10),
      open, high, low, close, volume,
    });
  }
  return historical;
}

function buildQuote(symbol: string, result: YahooChartResult): CedearQuote {
  const { meta } = result;
  const historical = buildHistorical(result);

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

// Obtiene solo el histórico de un ticker ya resuelto (ej. "MELI.BA") para
// un período extendido. Usa intervalos semanales/mensuales para períodos
// largos y así mantener el volumen de datos bajo.
export async function fetchExtendedHistorical(
  ticker: string,
  days: number
): Promise<HistoricalPoint[]> {
  try {
    const result = await fetchChartResult(ticker, days);
    return result ? buildHistorical(result) : [];
  } catch {
    return [];
  }
}

// Acepta tanto un ticker exacto (ej. "GGAL.BA") como el nombre de una
// empresa (ej. "Galicia"). Siempre intenta resolver el ticker .BA (CEDEAR
// en Buenos Aires) antes de caer en el ticker de bolsa extranjera, para
// evitar mostrar el precio del subyacente en USD en lugar del CEDEAR en ARS.
export async function fetchCedearQuote(rawQuery: string, days: number = HISTORY_DAYS): Promise<CedearQuote> {
  const trimmed = rawQuery.trim();
  if (!trimmed) {
    throw new CedearLookupError("Ingresá el nombre o código de una empresa", 400);
  }

  const directSymbol = trimmed.toUpperCase();

  // Si el usuario ya escribió un ticker .BA explícito, usarlo directo.
  if (directSymbol.endsWith(".BA")) {
    const result = await fetchChartResult(directSymbol, days);
    if (!result) {
      throw new CedearLookupError(
        `No se encontró ninguna empresa para "${rawQuery}"`,
        404
      );
    }
    return buildQuote(directSymbol, result);
  }

  // Para cualquier otro input, buscar primero en Yahoo Finance para que
  // pickBestSymbol pueda preferir la versión .BA (CEDEAR) si existe.
  const resolved = await searchSymbol(trimmed);

  // Si el search ya devolvió un .BA, usarlo directamente.
  if (resolved?.endsWith(".BA")) {
    const result = await fetchChartResult(resolved, days);
    if (result) return buildQuote(resolved, result);
  }

  // Si el search devolvió un ticker no-.BA (ej. TSLA de NASDAQ), intentar
  // primero la versión CEDEAR (TSLA.BA) antes de aceptar el extranjero.
  const baSymbol = (resolved ?? directSymbol) + ".BA";
  const baResult = await fetchChartResult(baSymbol, days);
  if (baResult) return buildQuote(baSymbol, baResult);

  // Fallback: usar el resultado del search o el ticker directo.
  if (resolved) {
    const result = await fetchChartResult(resolved, days);
    if (result) return buildQuote(resolved, result);
  }

  const fallbackResult = await fetchChartResult(directSymbol, days);
  if (!fallbackResult) {
    throw new CedearLookupError(
      `No se encontró ninguna empresa para "${rawQuery}"`,
      404
    );
  }
  return buildQuote(directSymbol, fallbackResult);
}
