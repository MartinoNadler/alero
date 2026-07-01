import { NextResponse, type NextRequest } from "next/server";
import { CedearLookupError, fetchCedearQuote, VALID_PERIODS } from "@/lib/yahoo-finance";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  const daysParam = request.nextUrl.searchParams.get("days");
  const days = VALID_PERIODS.find((p) => p === Number(daysParam)) ?? 30;

  try {
    const quote = await fetchCedearQuote(ticker ?? "", days);
    return NextResponse.json(quote);
  } catch (err) {
    if (err instanceof CedearLookupError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Error inesperado" }, { status: 500 });
  }
}
