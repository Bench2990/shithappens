"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-5 p-6">
      <span className="eyebrow">Ez most tényleg szar ügy.</span>
      <h1 className="text-4xl font-black tracking-tight">Megbotlott az oldal.</h1>
      <p className="text-muted">A játék az adatbázisban megmaradt. Próbáld újra, vagy frissítsd az oldalt ugyanebben a böngészőben.</p>
      <button className="button button-primary" onClick={reset}>Újrapróbálás</button>
    </main>
  );
}
