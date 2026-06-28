import { NextResponse, type NextRequest } from "next/server";
import { CedearLookupError, fetchCedearQuote } from "@/lib/yahoo-finance";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  try {
    const quote = await fetchCedearQuote(ticker ?? "");
    return NextResponse.json(quote);
  } catch (err) {
    if (err instanceof CedearLookupError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Error inesperado" }, { status: 500 });
  }
}
