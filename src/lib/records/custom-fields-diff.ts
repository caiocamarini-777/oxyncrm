/** Chaves cujo valor difere do armazenado (comparação profunda); chaves novas contam como alteradas. */
export function changedCustomFieldValues(
  values: Record<string, unknown>,
  current: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const stored = current ?? {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (k in stored && JSON.stringify(stored[k]) === JSON.stringify(v)) continue;
    out[k] = v;
  }
  return out;
}
