import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Szar ügy. – Mennyire rossz szerinted?",
  description: "Egy asztal, különböző ingerküszöbök. Valós idejű, baráti kártyajáték, ahol ti adjátok a pontszámokat.",
  robots: { index: false, follow: false },
  applicationName: "Szar ügy.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5f3ed",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="hu"><body>{children}</body></html>;
}
