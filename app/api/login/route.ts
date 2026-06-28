import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_NAME, createAuthCookieValue, verifyPassword } from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (!process.env.APP_PASSWORD) {
    return Response.json(
      { error: "Falta configurar APP_PASSWORD en el servidor" },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body inválido" }, { status: 400 });
  }

  const password = (body as Record<string, unknown> | null)?.password;
  if (typeof password !== "string" || !verifyPassword(password)) {
    return Response.json({ error: "Contraseña incorrecta" }, { status: 401 });
  }

  const cookieValue = createAuthCookieValue();
  if (!cookieValue) {
    return Response.json(
      { error: "Falta configurar APP_PASSWORD en el servidor" },
      { status: 500 }
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
