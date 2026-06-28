import { NextResponse, type NextRequest } from "next/server";
import type { CedearQuote } from "@/lib/cedear";
import { CedearLookupError, fetchCedearQuote } from "@/lib/yahoo-finance";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;
const MAX_TOOL_ITERATIONS = 3;
const TOOL_NAME = "buscar_empresa";

class ChatError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ChatError";
    this.status = status;
  }
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
  stop_reason: string;
  error?: { type: string; message: string };
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const TOOLS = [
  {
    name: TOOL_NAME,
    description:
      "Busca los datos de mercado actuales (precio, variación e histórico de 30 días) de una empresa, a partir de su nombre o de su código/ticker.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Nombre de la empresa o código/ticker, tal como lo escribió el usuario.",
        },
      },
      required: ["query"],
    },
  },
];

function formatQuoteContext(quote: CedearQuote): string {
  const historicalTable = quote.historical
    .map(
      (p) =>
        `${p.date}, apertura ${p.open}, máximo ${p.high}, mínimo ${p.low}, cierre ${p.close}, volumen ${p.volume}`
    )
    .join("\n");

  return `Datos actualmente cargados — ${quote.companyName} (código ${quote.ticker}, moneda ${quote.currency}, mercado ${quote.exchangeName}):
Precio actual: ${quote.currentPrice}
Cierre anterior: ${quote.previousClose}
Variación: ${quote.change} (${quote.changePercent.toFixed(2)}%)
Histórico de los últimos ${quote.historical.length} días hábiles:
${historicalTable}`;
}

function buildSystemPrompt(currentQuote: CedearQuote | null): string {
  const contextBlock = currentQuote
    ? formatQuoteContext(currentQuote)
    : "Todavía no hay ninguna empresa cargada en esta conversación.";

  return `Sos un asistente de chat que analiza datos de mercado de empresas (CEDEARs) para inversores argentinos no profesionales.

${contextBlock}

Reglas:
- Si el usuario menciona una empresa distinta a la que está cargada arriba (o todavía no hay ninguna cargada), usá la herramienta "${TOOL_NAME}" con el nombre o código que escribió, antes de responder.
- Si la pregunta es sobre la empresa que ya está cargada arriba, respondé directamente usando esos datos, sin volver a llamar la herramienta.
- Cuando acabás de cargar una empresa (primera vez o cambio de empresa), tu respuesta debe ser SOLO estas cuatro secciones, en este orden, cada título en su propia línea (sin dos puntos) seguido de 1 a 3 líneas que empiecen con "- ", y una línea en blanco entre secciones:
Precio actual
Tendencia
Volumen
Volatilidad
No agregues introducción, saludo ni cierre fuera de esas cuatro secciones. Si no hay nada relevante para alguna sección, escribí una sola línea breve indicándolo (por ejemplo "- Sin variaciones de volumen destacables").
- Cuando el usuario hace una pregunta puntual sobre la empresa ya cargada, respondé en párrafos cortos y conversacionales (sin las cuatro secciones ni guiones), específicamente a esa pregunta, sin repetir todo el análisis desde cero.
- Si la herramienta no encuentra resultados para el nombre que escribió el usuario, y vos sabés cuál es el código de esa empresa, volvé a llamar la herramienta usando ese código antes de responder, sin preguntarle al usuario primero. Solo si seguís sin encontrarla, explicaselo con claridad y pedile que aclare el nombre o código (en un párrafo normal, sin secciones).
- Nunca recomiendes comprar, vender o mantener ningún activo, ni opines sobre si es buen o mal momento para operar. Limitate a describir lo que muestran los datos.
- No uses la palabra "ticker"; decí "empresa" o "código".
- Usá lenguaje simple, sin jerga financiera. No uses Markdown (sin #, sin **).`;
}

async function callClaude(
  apiKey: string,
  system: string,
  messages: AnthropicMessage[]
): Promise<AnthropicResponse> {
  let response: Response;
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        system,
        tools: TOOLS,
        messages,
      }),
    });
  } catch {
    throw new ChatError("No se pudo conectar con la API de Claude", 502);
  }

  let data: AnthropicResponse;
  try {
    data = await response.json();
  } catch {
    throw new ChatError(
      `La API de Claude respondió con el estado ${response.status}`,
      502
    );
  }

  if (!response.ok || data.error) {
    throw new ChatError(
      data.error?.message ??
        `La API de Claude respondió con el estado ${response.status}`,
      502
    );
  }

  return data;
}

function isChatRequest(value: unknown): value is {
  message: string;
  history: ChatTurn[];
  quote: CedearQuote | null;
} {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.message !== "string" || !v.message.trim()) return false;
  if (!Array.isArray(v.history)) return false;
  if (v.quote !== null && typeof v.quote !== "object") return false;
  return true;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Falta configurar ANTHROPIC_API_KEY en el servidor" },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body inválido, se esperaba JSON" },
      { status: 400 }
    );
  }

  if (!isChatRequest(body)) {
    return NextResponse.json(
      { error: "Falta el mensaje del usuario" },
      { status: 400 }
    );
  }

  const { message, history, quote: currentQuote } = body;

  const messages: AnthropicMessage[] = [
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user", content: message },
  ];

  let newQuote: CedearQuote | null = null;

  try {
    let claudeResponse = await callClaude(
      apiKey,
      buildSystemPrompt(currentQuote),
      messages
    );
    let iterations = 0;

    while (claudeResponse.stop_reason === "tool_use" && iterations < MAX_TOOL_ITERATIONS) {
      iterations++;
      const toolUse = claudeResponse.content.find(
        (block): block is AnthropicToolUseBlock => block.type === "tool_use"
      );
      if (!toolUse) break;

      messages.push({ role: "assistant", content: claudeResponse.content });

      let toolResultText: string;
      try {
        const query = toolUse.input.query;
        const found = await fetchCedearQuote(typeof query === "string" ? query : "");
        newQuote = found;
        toolResultText = formatQuoteContext(found);
      } catch (err) {
        toolResultText =
          err instanceof CedearLookupError
            ? err.message
            : "No se pudo obtener la información solicitada.";
      }

      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: toolResultText,
          },
        ],
      });

      claudeResponse = await callClaude(
        apiKey,
        buildSystemPrompt(newQuote ?? currentQuote),
        messages
      );
    }

    const reply = claudeResponse.content
      .filter(
        (block): block is AnthropicTextBlock =>
          block.type === "text" && Boolean(block.text)
      )
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!reply) {
      return NextResponse.json(
        { error: "Claude no devolvió una respuesta" },
        { status: 502 }
      );
    }

    return NextResponse.json({ reply, quote: newQuote });
  } catch (err) {
    if (err instanceof ChatError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Error inesperado" }, { status: 500 });
  }
}
