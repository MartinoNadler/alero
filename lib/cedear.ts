export interface HistoricalPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CedearQuote {
  ticker: string;
  companyName: string;
  currency: string;
  exchangeName: string;
  currentPrice: number;
  previousClose: number;
  change: number;
  changePercent: number;
  historical: HistoricalPoint[];
}
