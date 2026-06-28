"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArchIcon } from "../components/ArchIcon";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!password || isBusy) return;

    setIsBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error ?? "No se pudo iniciar sesión");
      }

      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ocurrió un error inesperado");
      setIsBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8">
        <div className="flex items-center gap-3">
          <ArchIcon className="h-8 w-8 shrink-0 text-[#4A90D9]" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Alero</h1>
            <p className="text-xs text-muted">Acceso protegido</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Contraseña"
            autoFocus
            disabled={isBusy}
            className="rounded-xl border border-line bg-background px-4 py-2.5 text-sm outline-none placeholder:text-muted focus:border-accent disabled:opacity-50"
          />

          {error && <p className="text-sm text-down">{error}</p>}

          <button
            type="submit"
            disabled={isBusy || !password}
            className="rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-accent/90 disabled:opacity-50"
          >
            {isBusy ? "Verificando…" : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
