import { LoaderCircle, X } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({ busy, children, className = "", variant = "primary", disabled, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; variant?: "primary" | "secondary" | "lime" }) {
  return (
    <button className={`button button-${variant} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined} {...props}>
      {busy && <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function SectionHeading({ label, title, children }: { label: string; title: string; children?: ReactNode }) {
  return <div className="mb-6"><p className="eyebrow mb-2 text-muted">{label}</p><h1 className="text-3xl leading-tight font-black tracking-tight sm:text-4xl">{title}</h1>{children && <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted">{children}</p>}</div>;
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return <div role="alert" className="mb-5 flex items-start gap-3 rounded-2xl border border-[#d8a58f] bg-[#fff0e8] p-4 text-sm leading-relaxed">
    <p className="flex-1">{message}</p>
    {onDismiss && <button aria-label="Hibaüzenet bezárása" onClick={onDismiss} className="-m-2 grid size-11 shrink-0 place-items-center rounded-lg"><X className="size-4" aria-hidden="true" /></button>}
  </div>;
}
