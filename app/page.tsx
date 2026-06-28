"use client";

import { useEffect, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CedearQuote, HistoricalPoint } from "@/lib/cedear";
import { ArchIcon } from "./components/ArchIcon";

interface DisplayTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  quote?: CedearQuote;
  isError?: boolean;
  followUpQuestions?: string[];
}

const WELCOME_TURN: DisplayTurn = {
  id: "welcome",
  role: "assistant",
  text:
    "¡Hola! Decime el nombre o el código de una empresa y te muestro el gráfico y un análisis de los últimos 30 días.\n\nDespués podés seguir preguntándome sobre esos datos, o nombrar otra empresa en cualquier momento.",
};

const SUGGESTIONS = ["Apple", "Tesla", "Galicia", "MercadoLibre"];

const UP_COLOR = "#196edc";
const DOWN_COLOR = "#ef4444";

const ANALYSIS_SECTION_TITLES = ["Precio actual", "Tendencia", "Volumen", "Volatilidad"];

const DISCLAIMER_TEXT =
  "Este análisis tiene carácter exclusivamente informativo y educativo. No constituye asesoramiento financiero, recomendación de inversión ni oferta de compra o venta de valores negociables en los términos de la Ley N° 26.831. Las decisiones de inversión son responsabilidad exclusiva del usuario. Rentabilidad pasada no garantiza resultados futuros.";

interface AnalysisSection {
  title: string;
  lines: string[];
}

function parseAnalysisSections(text: string): AnalysisSection[] | null {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const sections: AnalysisSection[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    const title = lines[0].replace(/:$/, "");
    if (!ANALYSIS_SECTION_TITLES.includes(title)) return null;

    sections.push({
      title,
      lines: lines.slice(1).map((l) => l.replace(/^[-•]\s*/, "")),
    });
  }

  return sections.length > 0 ? sections : null;
}

function formatCurrency(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

function formatChartDate(isoDate: string) {
  const [, month, day] = isoDate.split("-");
  return `${day}/${month}`;
}

function PriceChart({
  historical,
  isUp,
}: {
  historical: HistoricalPoint[];
  isUp: boolean;
}) {
  const data = historical.map((point) => ({
    date: point.date,
    close: point.close,
  }));
  const color = isUp ? UP_COLOR : DOWN_COLOR;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
        <CartesianGrid stroke="#ffffff0f" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatChartDate}
          stroke="#6b7280"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          minTickGap={28}
        />
        <YAxis
          orientation="right"
          domain={["auto", "auto"]}
          stroke="#6b7280"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={52}
          tickFormatter={(value: number) => value.toFixed(0)}
        />
        <Tooltip
          contentStyle={{
            background: "#12121a",
            border: "1px solid #232733",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: "#6b7280" }}
          itemStyle={{ color: "#e5e7eb" }}
          formatter={(
            value: number | undefined | null | string | readonly (string | number)[]
          ) => {
            if (typeof value !== "number") return ["", "Cierre"];
            return [value.toFixed(2), "Cierre"];
          }}
        />
        <Line
          type="monotone"
          dataKey="close"
          stroke={color}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive
          animationDuration={500}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function QuoteCard({ quote }: { quote: CedearQuote }) {
  const isUp = quote.change >= 0;
  return (
    <div className="mb-3 rounded-xl border border-line bg-background/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-lg font-bold tracking-tight">{quote.companyName}</p>
          <p className="text-xs text-muted">
            {quote.ticker} · {quote.exchangeName} · {quote.currency}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            isUp ? "bg-up/10 text-up" : "bg-down/10 text-down"
          }`}
        >
          {isUp ? "▲" : "▼"} {quote.changePercent.toFixed(2)}%
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <span className="text-3xl font-bold tabular-nums">
          {formatCurrency(quote.currentPrice, quote.currency)}
        </span>
        <span
          className={`text-sm font-medium tabular-nums ${
            isUp ? "text-up" : "text-down"
          }`}
        >
          {isUp ? "+" : ""}
          {formatCurrency(quote.change, quote.currency)}
        </span>
      </div>

      <div className="mt-3">
        <PriceChart historical={quote.historical} isUp={isUp} />
      </div>
    </div>
  );
}

function AnalysisText({ text }: { text: string }) {
  const sections = parseAnalysisSections(text);

  if (!sections) {
    return (
      <>
        {text.split("\n\n").map((paragraph, i) => (
          <p key={i} className={i > 0 ? "mt-2" : undefined}>
            {paragraph}
          </p>
        ))}
      </>
    );
  }

  return (
    <div className="space-y-3">
      {sections.map((section) => (
        <div key={section.title}>
          <p className="text-xs font-semibold uppercase tracking-wide text-up">
            {section.title}
          </p>
          <ul className="mt-1 space-y-1">
            {section.lines.map((line, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function MessageBubble({
  turn,
  showFollowUps,
  onSelectQuestion,
}: {
  turn: DisplayTurn;
  showFollowUps: boolean;
  onSelectQuestion: (question: string) => void;
}) {
  if (turn.role === "user") {
    return (
      <div className="max-w-[85%] animate-message-in self-end rounded-2xl rounded-tr-sm bg-accent px-4 py-3 text-sm text-white">
        {turn.text}
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-xl flex-col items-start gap-2">
      <div
        className={
          turn.isError
            ? "max-w-[85%] animate-message-in self-start rounded-2xl rounded-tl-sm border border-down/30 bg-down/10 px-4 py-3 text-sm text-down"
            : "w-full animate-message-in self-start rounded-2xl rounded-tl-sm bg-surface px-4 py-3 text-sm leading-relaxed"
        }
      >
        {turn.quote && <QuoteCard quote={turn.quote} />}
        <AnalysisText text={turn.text} />
      </div>

      {showFollowUps && turn.followUpQuestions && turn.followUpQuestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {turn.followUpQuestions.map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => onSelectQuestion(question)}
              className="rounded-full border border-accent bg-transparent px-3 py-1.5 text-left text-xs font-medium text-accent transition-colors hover:bg-accent hover:text-white"
            >
              {question}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DisclaimerModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md animate-message-in rounded-2xl border border-line bg-surface p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-base font-bold">Aviso legal</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="shrink-0 text-muted transition-colors hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <div className="mt-4 text-sm leading-relaxed text-foreground/90">
          {DISCLAIMER_TEXT.split("\n\n").map((paragraph, i) => (
            <p key={i} className={i > 0 ? "mt-2" : undefined}>
              {paragraph}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

type StreamEvent =
  | { type: "text"; text: string }
  | { type: "quote"; quote: CedearQuote }
  | { type: "questions"; questions: string[] }
  | { type: "error"; error: string };

export default function Home() {
  const [turns, setTurns] = useState<DisplayTurn[]>([WELCOME_TURN]);
  const [input, setInput] = useState("");
  const [currentQuote, setCurrentQuote] = useState<CedearQuote | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, isBusy]);

  async function sendMessage(rawText: string) {
    const text = rawText.trim();
    if (!text || isBusy) return;

    const historyForApi = turns.map((t) => ({ role: t.role, content: t.text }));
    const previousQuestions = turns.flatMap((t) => t.followUpQuestions ?? []);

    setTurns((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text }]);
    setInput("");
    setIsBusy(true);

    const assistantId = crypto.randomUUID();
    let assistantTurnCreated = false;

    function ensureAssistantTurn() {
      if (assistantTurnCreated) return;
      assistantTurnCreated = true;
      setStreamingId(assistantId);
      setTurns((prev) => [...prev, { id: assistantId, role: "assistant", text: "" }]);
    }

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: historyForApi,
          quote: currentQuote,
          previousQuestions,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "No se pudo obtener una respuesta");
      }
      if (!response.body) {
        throw new Error("La respuesta del servidor no incluyó contenido");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line) continue;

          const event = JSON.parse(line) as StreamEvent;

          if (event.type === "text") {
            ensureAssistantTurn();
            setTurns((prev) =>
              prev.map((t) =>
                t.id === assistantId ? { ...t, text: t.text + event.text } : t
              )
            );
          } else if (event.type === "quote") {
            ensureAssistantTurn();
            setCurrentQuote(event.quote);
            setTurns((prev) =>
              prev.map((t) => (t.id === assistantId ? { ...t, quote: event.quote } : t))
            );
          } else if (event.type === "questions") {
            ensureAssistantTurn();
            setTurns((prev) =>
              prev.map((t) =>
                t.id === assistantId ? { ...t, followUpQuestions: event.questions } : t
              )
            );
          } else if (event.type === "error") {
            streamError = event.error;
          }
        }
      }

      if (streamError) throw new Error(streamError);
      if (!assistantTurnCreated) throw new Error("Claude no devolvió una respuesta");
    } catch (err) {
      setTurns((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text:
            err instanceof Error
              ? err.message
              : "Ocurrió un error inesperado. Probá de nuevo.",
          isError: true,
        },
      ]);
    } finally {
      setStreamingId(null);
      setIsBusy(false);
    }
  }

  const showSuggestions = turns.length === 1;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="shrink-0 px-4 py-4 shadow-sm shadow-black/30 sm:px-8">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <ArchIcon className="h-8 w-8 shrink-0 text-[#4A90D9]" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Alero</h1>
            <p className="text-xs text-muted">Análisis de empresas con IA</p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-2xl flex-col items-start gap-3">
          {turns.map((turn, i) => (
            <MessageBubble
              key={turn.id}
              turn={turn}
              showFollowUps={i === turns.length - 1}
              onSelectQuestion={sendMessage}
            />
          ))}

          {showSuggestions && !isBusy && (
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((company) => (
                <button
                  key={company}
                  type="button"
                  onClick={() => sendMessage(company)}
                  className="rounded-full border border-accent bg-transparent px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent hover:text-white"
                >
                  {company}
                </button>
              ))}
            </div>
          )}

          {isBusy && !streamingId && (
            <div className="w-full max-w-xl animate-message-in self-start rounded-2xl rounded-tl-sm bg-surface px-4 py-3 text-sm">
              <span className="inline-flex gap-1">
                <span
                  className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-muted"
                  style={{ animationDelay: "0ms" }}
                />
                <span
                  className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-muted"
                  style={{ animationDelay: "150ms" }}
                />
                <span
                  className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-muted"
                  style={{ animationDelay: "300ms" }}
                />
              </span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </main>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(input);
        }}
        className="shrink-0 px-4 py-4 sm:px-8"
      >
        <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-2xl border border-line bg-surface p-1.5 transition-all duration-200 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              currentQuote
                ? "Preguntá algo más o nombrá otra empresa…"
                : "Nombre o código de una empresa, ej: Apple o Galicia"
            }
            disabled={isBusy}
            className="flex-1 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isBusy || !input.trim()}
            className="shrink-0 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-accent/90 disabled:opacity-50"
          >
            {isBusy ? "Analizando…" : "Analizar"}
          </button>
        </div>
      </form>

      <footer className="shrink-0 border-t border-line px-4 py-3 sm:px-8">
        <p className="mx-auto max-w-2xl text-center text-[11px] text-muted">
          Análisis informativo · No es asesoramiento financiero ·{" "}
          <button
            type="button"
            onClick={() => setShowDisclaimer(true)}
            className="underline underline-offset-2 transition-colors hover:text-accent"
          >
            Ver aviso legal
          </button>
        </p>
      </footer>

      {showDisclaimer && (
        <DisclaimerModal onClose={() => setShowDisclaimer(false)} />
      )}
    </div>
  );
}
