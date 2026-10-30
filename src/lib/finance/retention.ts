/**
 * Retenção proporcional ao novo bruto: mantém a mesma alíquota efetiva do lançamento
 * (retenção ÷ bruto antigos), arredondada a 2 casas. Bruto antigo 0 → 0.
 */
export function scaledRetention(newGross: number, oldGross: number, oldRetention: number): number {
  if (!(oldGross > 0) || !(oldRetention > 0)) return 0;
  const cents = Math.round((Math.round(newGross * 100) * Math.round(oldRetention * 100)) / Math.round(oldGross * 100));
  return Math.min(cents, Math.round(newGross * 100)) / 100;
}
