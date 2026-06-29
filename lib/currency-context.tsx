"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Currency = "ARS" | "USD";

interface CurrencyContextValue {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  mepRate: number | null;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

const BLUELYTICS_URL = "https://api.bluelytics.com.ar/v2/latest";

interface BluelyticsResponse {
  blue: { value_sell: number };
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrency] = useState<Currency>("USD");
  const [mepRate, setMepRate] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(BLUELYTICS_URL)
      .then((res) => res.json())
      .then((data: BluelyticsResponse) => {
        if (!cancelled && typeof data?.blue?.value_sell === "number") {
          setMepRate(data.blue.value_sell);
        }
      })
      .catch(() => {
        // Si falla el fetch, el toggle a ARS queda deshabilitado.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, mepRate }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) {
    throw new Error("useCurrency debe usarse dentro de un CurrencyProvider");
  }
  return ctx;
}
