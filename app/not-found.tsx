import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-5 p-6">
      <span className="eyebrow">404 · Rossz helyre tetted.</span>
      <h1 className="text-4xl font-black tracking-tight">Itt nincs kártya.</h1>
      <Link className="button button-primary" href="/">Vissza az asztalhoz</Link>
    </main>
  );
}
