/** A kijelzéshez osztunk tízzel; összehasonlítás kizárólag egész tizedpontokon történik a DB-ben. */
export function formatScore(tenths: number, decimal = false): string {
  return new Intl.NumberFormat("hu-HU", {
    minimumFractionDigits: decimal ? 1 : 0,
    maximumFractionDigits: 1,
  }).format(tenths / 10);
}

export function placementLabel(lower: number | null, upper: number | null): string {
  if (lower === null && upper === null) return "Az első helyre";
  if (lower === null) return `${formatScore(upper!)} elé`;
  if (upper === null) return `${formatScore(lower)} mögé`;
  return `${formatScore(lower)} és ${formatScore(upper)} közé`;
}
