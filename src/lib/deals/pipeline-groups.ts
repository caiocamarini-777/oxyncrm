export type PipelineGroup = { slug: string; name: string; pipelines: { id: string; name: string }[] };

type DirectoryEntry = { id: string; name: string; companyName: string; companySlug: string };

/**
 * Funis agrupados por empresa para o seletor de Negócios: a empresa aberta primeiro, as demais em ordem
 * alfabética. Sem diretório, mostra só os funis da empresa aberta.
 */
export function pipelineGroups(
  directory: DirectoryEntry[],
  current: { id: string; name: string }[],
  companySlug: string | null,
): PipelineGroup[] {
  if (directory.length === 0) {
    return current.length ? [{ slug: companySlug ?? "", name: "Funis", pipelines: current }] : [];
  }
  const map = new Map<string, PipelineGroup>();
  for (const d of directory) {
    const g = map.get(d.companySlug) ?? { slug: d.companySlug, name: d.companyName, pipelines: [] };
    g.pipelines.push({ id: d.id, name: d.name });
    map.set(d.companySlug, g);
  }
  return [...map.values()].sort((a, b) => {
    if (a.slug === companySlug) return -1;
    if (b.slug === companySlug) return 1;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}
