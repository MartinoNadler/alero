import { type NextRequest } from "next/server";
import type { CedearQuote } from "@/lib/cedear";
import { CedearLookupError, fetchCedearQuote, fetchExtendedHistorical } from "@/lib/yahoo-finance";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;
const MAX_TOOL_ITERATIONS = 4;
const TOOL_NAME = "buscar_empresa";
const FOLLOWUP_TOOL_NAME = "sugerir_preguntas";
const HISTORY_TOOL_NAME = "obtener_historico";
const MAX_FOLLOWUP_QUESTIONS = 3;

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
  {
    name: FOLLOWUP_TOOL_NAME,
    description:
      "Sugiere 2 o 3 preguntas de seguimiento concretas para que el usuario las toque y las envíe tal cual. Se llama siempre al final de la respuesta, después de escribir el texto.",
    input_schema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: MAX_FOLLOWUP_QUESTIONS,
          description:
            "2 o 3 preguntas de seguimiento específicas, basadas en datos reales ya mencionados (fechas, magnitudes, anomalías), redactadas en primera persona como las escribiría el usuario.",
        },
      },
      required: ["questions"],
    },
  },
  {
    name: HISTORY_TOOL_NAME,
    description:
      "Obtiene el histórico de precios de la empresa actualmente cargada para un período mayor a 30 días. Usá esta herramienta solo cuando el usuario pregunte sobre tendencias, movimientos o eventos de más de 30 días atrás y no puedas responder con los datos que ya tenés. Para 90 días usa intervalo diario, para 1 año semanal y para 5 años mensual, reduciendo el volumen de datos.",
    input_schema: {
      type: "object",
      properties: {
        days: {
          type: "number",
          enum: [90, 365, 1825],
          description: "Período en días: 90 para ~3 meses, 365 para ~1 año, 1825 para ~5 años.",
        },
      },
      required: ["days"],
    },
  },
  {
    type: "web_search_20260209",
    name: "web_search",
    max_uses: 3,
  },
];

function formatExtendedHistorical(
  historical: import("@/lib/cedear").HistoricalPoint[],
  days: number
): string {
  const label = days >= 1825 ? "5 años" : days >= 365 ? "1 año" : "90 días";
  const table = historical
    .map(
      (p) =>
        `${p.date}, apertura ${p.open}, máximo ${p.high}, mínimo ${p.low}, cierre ${p.close}, volumen ${p.volume}`
    )
    .join("\n");
  return `Histórico extendido (últimos ${label}):\n${table}`;
}

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

function buildSystemPrompt(
  currentQuote: CedearQuote | null,
  previousQuestions: string[]
): string {
  const contextBlock = currentQuote
    ? formatQuoteContext(currentQuote)
    : "Todavía no hay ninguna empresa cargada en esta conversación.";

  const previousQuestionsBlock =
    previousQuestions.length > 0
      ? `\n\nPreguntas de seguimiento que ya sugeriste antes en esta conversación (no las repitas ni sugieras otras muy parecidas):\n${previousQuestions
          .map((q) => `- ${q}`)
          .join("\n")}`
      : "";

  return `Sos un asistente de chat que analiza datos de mercado de empresas (CEDEARs) para inversores argentinos no profesionales.

${contextBlock}${previousQuestionsBlock}

Reglas:
- Si el usuario menciona una empresa distinta a la que está cargada arriba (o todavía no hay ninguna cargada), usá la herramienta "${TOOL_NAME}" con el nombre o código que escribió, antes de responder.
- Si la pregunta es sobre la empresa que ya está cargada arriba, respondé directamente usando esos datos, sin volver a llamar la herramienta.
- Cuando acabás de cargar una empresa (primera vez o cambio de empresa), tu respuesta depende de cómo lo pidió el usuario:
  a) Si el usuario escribió solo el nombre o código de la empresa (sin verbo, sin pregunta explícita), hacé el análisis completo con SOLO estas cuatro secciones, en este orden, cada título en su propia línea (sin dos puntos) seguido de 1 a 3 líneas que empiecen con "- ", y una línea en blanco entre secciones:
Precio actual
Tendencia
Volumen
Volatilidad
No agregues introducción, saludo ni cierre fuera de esas cuatro secciones.
  b) Si el usuario preguntó explícitamente solo por el precio (ej: "dame el precio de X", "¿cuánto está X?", "precio de X"), escribí UNA sola frase corta confirmando el precio actual y nada más. El gráfico ya se muestra en pantalla.
  c) Si el usuario pidió explícitamente el gráfico (ej: "dame el gráfico de X", "mostrame el gráfico de X", "gráfico de X", "quiero ver el gráfico"), escribí UNA sola frase corta confirmando que ahí está el gráfico y nada más. No agregues las cuatro secciones del análisis.
- Cuando el usuario hace una pregunta puntual sobre la empresa ya cargada, respondé en párrafos cortos y conversacionales, específicamente a esa pregunta, sin repetir todo el análisis desde cero.
- Si la herramienta no encuentra resultados para el nombre que escribió el usuario, y vos sabés cuál es el código de esa empresa, volvé a llamar la herramienta usando ese código antes de responder, sin preguntarle al usuario primero. Solo si seguís sin encontrarla, explicaselo con claridad y pedile que aclare el nombre o código (en un párrafo normal, sin secciones).
- Nunca recomiendes comprar, vender o mantener ningún activo, ni opines sobre si es buen o mal momento para operar. Limitate a describir lo que muestran los datos.
- No uses la palabra "ticker"; decí "empresa" o "código".
- Escribí como si le explicaras a un amigo que nunca invirtió en su vida. Nada de tecnicismos.
- Palabras y frases PROHIBIDAS — reemplazalas siempre:
  "presión bajista" → "el precio estuvo cayendo varios días seguidos"
  "presión alcista" → "el precio estuvo subiendo varios días seguidos"
  "rango intradía" → "diferencia entre el precio más alto y más bajo del día"
  "soporte" / "resistencia" → no los uses, describí el movimiento directamente
  "volumen" → "cantidad de operaciones" o "cuánta gente compró y vendió ese día"
  "mínimo del período" → "el precio más bajo que tuvo en este tiempo"
  "máximo del período" → "el precio más alto que tuvo en este tiempo"
- Después de cada dato numérico agregá una línea que explique qué significa en términos simples. Ejemplo: "El precio más bajo fue $21.130 el 25 de junio. Eso quiere decir que en ese momento valía casi $3.000 menos que al inicio del mes."
- No uses Markdown (sin #, sin **).
- Si el usuario pregunta sobre un período mayor a 30 días (ej: "últimos 3 meses", "en el último año", "desde enero", o menciona una fecha de más de 30 días atrás), llamá primero a la herramienta "${HISTORY_TOOL_NAME}" con el período apropiado (90, 365 o 1825 días) antes de responder. No la uses si ya tenés los datos necesarios en el histórico de 30 días.
- Los datos de precio, variación e histórico de volumen no explican por sí solos el motivo de un movimiento. Si la pregunta del usuario es sobre la causa de una suba o baja, noticias, eventos corporativos (resultados, fusiones, demandas, anuncios) u otros fundamentos que no están en los datos numéricos que tenés, usá la herramienta de búsqueda web para complementar tu respuesta antes de responder. Si podés responder completamente con los datos de precio y volumen que ya tenés, no uses la búsqueda web.
- Cuando tu respuesta se base en resultados de la búsqueda web, sé breve: máximo 150 palabras, yendo directo al punto — la causa principal del movimiento y 1 o 2 datos de contexto. Nada de listas largas ni de enumerar varios factores.
- Después de escribir tu respuesta (el análisis completo o una respuesta puntual), llamá siempre a la herramienta "${FOLLOWUP_TOOL_NAME}" con 2 o 3 preguntas de seguimiento. Tienen que basarse en datos concretos que ya mencionaste (una fecha puntual, una variación específica, un volumen inusual, una anomalía), nunca preguntas genéricas como "¿querés saber algo más?". Escribilas en primera persona, tal como las escribiría el usuario, listas para enviar (ej: "¿Por qué bajó tan fuerte el 25 de junio?"). No llames a esta herramienta si todavía no escribiste ninguna respuesta (por ejemplo, mientras estás buscando una empresa).
- Nunca repitas una pregunta de seguimiento que ya sugeriste antes en esta conversación.`;
}

interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
}

async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separatorIndex: number;
      while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);

        let eventType = "message";
        const dataLines: string[] = [];
        for (const line of rawEvent.split("\n")) {
          if (line.startsWith("event:")) eventType = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) continue;

        try {
          yield { event: eventType, data: JSON.parse(dataLines.join("\n")) };
        } catch {
          // ignore malformed SSE event
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

type StreamBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; inputJson: string };

async function streamClaudeTurn(
  apiKey: string,
  system: string,
  messages: AnthropicMessage[],
  onTextDelta: (text: string) => void
): Promise<{ content: AnthropicContentBlock[]; stopReason: string }> {
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
        stream: true,
      }),
    });
  } catch {
    throw new ChatError("No se pudo conectar con la API de Claude", 502);
  }

  if (!response.ok || !response.body) {
    let message = `La API de Claude respondió con el estado ${response.status}`;
    try {
      const errBody = await response.json();
      message = errBody?.error?.message ?? message;
    } catch {
      // keep default message
    }
    throw new ChatError(message, 502);
  }

  const blocks: StreamBlock[] = [];
  let stopReason = "end_turn";

  for await (const { data } of parseSSE(response.body)) {
    const type = data.type as string;

    if (type === "content_block_start") {
      const index = data.index as number;
      const block = data.content_block as { type: string; id?: string; name?: string };
      if (block.type === "text") {
        blocks[index] = { type: "text", text: "" };
      } else if (block.type === "tool_use") {
        blocks[index] = {
          type: "tool_use",
          id: block.id ?? "",
          name: block.name ?? "",
          inputJson: "",
        };
      }
    } else if (type === "content_block_delta") {
      const index = data.index as number;
      const block = blocks[index];
      const delta = data.delta as { type: string; text?: string; partial_json?: string };
      if (!block) continue;
      if (delta.type === "text_delta" && block.type === "text") {
        block.text += delta.text ?? "";
        onTextDelta(delta.text ?? "");
      } else if (delta.type === "input_json_delta" && block.type === "tool_use") {
        block.inputJson += delta.partial_json ?? "";
      }
    } else if (type === "message_delta") {
      const delta = data.delta as { stop_reason?: string };
      if (delta?.stop_reason) stopReason = delta.stop_reason;
    } else if (type === "error") {
      const error = data.error as { message?: string } | undefined;
      throw new ChatError(error?.message ?? "Error en el stream de Claude", 502);
    }
  }

  const content: AnthropicContentBlock[] = blocks
    .filter((block): block is StreamBlock => Boolean(block))
    .map((block) => {
      if (block.type === "text") return { type: "text", text: block.text };
      let input: Record<string, unknown> = {};
      try {
        input = block.inputJson ? JSON.parse(block.inputJson) : {};
      } catch {
        input = {};
      }
      return { type: "tool_use", id: block.id, name: block.name, input };
    });

  return { content, stopReason };
}

function isChatRequest(value: unknown): value is {
  message: string;
  history: ChatTurn[];
  quote: CedearQuote | null;
  previousQuestions?: string[];
} {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.message !== "string" || !v.message.trim()) return false;
  if (!Array.isArray(v.history)) return false;
  if (v.quote !== null && typeof v.quote !== "object") return false;
  if (v.previousQuestions !== undefined && !Array.isArray(v.previousQuestions)) return false;
  return true;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Falta configurar ANTHROPIC_API_KEY en el servidor" },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body inválido, se esperaba JSON" }, { status: 400 });
  }

  if (!isChatRequest(body)) {
    return Response.json({ error: "Falta el mensaje del usuario" }, { status: 400 });
  }

  const { message, history, quote: currentQuote, previousQuestions = [] } = body;
  const askedQuestions = previousQuestions.filter((q): q is string => typeof q === "string");

  const messages: AnthropicMessage[] = [
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user", content: message },
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      function send(payload: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      }

      let newQuote: CedearQuote | null = null;

      try {
        let iterations = 0;
        let turn = await streamClaudeTurn(
          apiKey,
          buildSystemPrompt(currentQuote, askedQuestions),
          messages,
          (text) => send({ type: "text", text })
        );

        while (
          (turn.stopReason === "tool_use" || turn.stopReason === "pause_turn") &&
          iterations < MAX_TOOL_ITERATIONS
        ) {
          iterations++;

          if (turn.stopReason === "pause_turn") {
            // Server-side tool (web search) hit its internal iteration cap.
            // Resend as-is to let it resume — no extra user message.
            messages.push({ role: "assistant", content: turn.content });
            turn = await streamClaudeTurn(
              apiKey,
              buildSystemPrompt(newQuote ?? currentQuote, askedQuestions),
              messages,
              (text) => send({ type: "text", text })
            );
            continue;
          }

          const toolUses = turn.content.filter(
            (block): block is AnthropicToolUseBlock => block.type === "tool_use"
          );
          if (toolUses.length === 0) break;

          const searchToolUse = toolUses.find((t) => t.name === TOOL_NAME);
          const followUpToolUse = toolUses.find((t) => t.name === FOLLOWUP_TOOL_NAME);
          const historyToolUse = toolUses.find((t) => t.name === HISTORY_TOOL_NAME);

          if (followUpToolUse) {
            const rawQuestions = followUpToolUse.input.questions;
            if (Array.isArray(rawQuestions)) {
              const questions = rawQuestions
                .filter((q): q is string => typeof q === "string")
                .slice(0, MAX_FOLLOWUP_QUESTIONS);
              if (questions.length > 0) send({ type: "questions", questions });
            }
          }

          // Herramienta de histórico extendido: fetcha más días del ticker actual.
          if (historyToolUse && !searchToolUse) {
            const activeTicker = (newQuote ?? currentQuote)?.ticker;
            const rawDays = historyToolUse.input.days;
            const days = typeof rawDays === "number" ? rawDays : 90;

            messages.push({ role: "assistant", content: turn.content });

            let historyResultText: string;
            if (activeTicker) {
              const historical = await fetchExtendedHistorical(activeTicker, days);
              historyResultText = historical.length > 0
                ? formatExtendedHistorical(historical, days)
                : "No se pudo obtener el histórico extendido.";
            } else {
              historyResultText = "No hay ninguna empresa cargada para obtener el histórico.";
            }

            const historyResults: AnthropicToolResultBlock[] = [
              { type: "tool_result", tool_use_id: historyToolUse.id, content: historyResultText },
            ];
            if (followUpToolUse) {
              historyResults.push({
                type: "tool_result",
                tool_use_id: followUpToolUse.id,
                content: "ok",
              });
            }
            messages.push({ role: "user", content: historyResults });

            turn = await streamClaudeTurn(
              apiKey,
              buildSystemPrompt(newQuote ?? currentQuote, askedQuestions),
              messages,
              (text) => send({ type: "text", text })
            );
            continue;
          }

          if (!searchToolUse) break;

          messages.push({ role: "assistant", content: turn.content });

          let toolResultText: string;
          try {
            const query = searchToolUse.input.query;
            const found = await fetchCedearQuote(typeof query === "string" ? query : "");
            newQuote = found;
            toolResultText = formatQuoteContext(found);
            send({ type: "quote", quote: newQuote });
          } catch (err) {
            toolResultText =
              err instanceof CedearLookupError
                ? err.message
                : "No se pudo obtener la información solicitada.";
          }

          const toolResults: AnthropicToolResultBlock[] = [
            { type: "tool_result", tool_use_id: searchToolUse.id, content: toolResultText },
          ];
          if (followUpToolUse) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: followUpToolUse.id,
              content: "ok",
            });
          }
          messages.push({ role: "user", content: toolResults });

          turn = await streamClaudeTurn(
            apiKey,
            buildSystemPrompt(newQuote ?? currentQuote, askedQuestions),
            messages,
            (text) => send({ type: "text", text })
          );
        }

        const reply = turn.content
          .filter(
            (block): block is AnthropicTextBlock =>
              block.type === "text" && Boolean(block.text)
          )
          .map((block) => block.text)
          .join("\n")
          .trim();

        if (!reply) {
          send({ type: "error", error: "Claude no devolvió una respuesta" });
        }
      } catch (err) {
        send({
          type: "error",
          error: err instanceof ChatError ? err.message : "Error inesperado",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
