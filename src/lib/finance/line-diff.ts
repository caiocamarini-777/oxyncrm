/** Diferença entre as linhas gravadas e as enviadas pelo editor, casadas por id. */
export function diffLineIds(existingIds: string[], incoming: { id?: string | null }[]) {
  const existing = new Set(existingIds);
  const kept = new Set<string>();
  const update: number[] = [];
  const insert: number[] = [];
  incoming.forEach((l, i) => {
    if (l.id && existing.has(l.id) && !kept.has(l.id)) {
      kept.add(l.id);
      update.push(i);
    } else insert.push(i);
  });
  return { update, insert, remove: existingIds.filter((id) => !kept.has(id)) };
}
