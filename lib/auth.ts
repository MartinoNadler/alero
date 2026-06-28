import { createHmac, timingSafeEqual } from "node:crypto";

export const AUTH_COOKIE_NAME = "alero_auth";
const SESSION_VALUE = "authenticated";

function getAppPassword(): string | undefined {
  return process.env.APP_PASSWORD;
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function verifyPassword(password: string): boolean {
  const appPassword = getAppPassword();
  if (!appPassword) return false;
  return safeEqual(password, appPassword);
}

export function createAuthCookieValue(): string | null {
  const appPassword = getAppPassword();
  if (!appPassword) return null;
  return sign(SESSION_VALUE, appPassword);
}

export function isValidAuthCookie(value: string | undefined | null): boolean {
  if (!value) return false;
  const appPassword = getAppPassword();
  if (!appPassword) return false;
  return safeEqual(value, sign(SESSION_VALUE, appPassword));
}
