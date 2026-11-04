/** Troca {{chave}} (com espaços tolerados) pelo valor; o que falta fica vazio. */
export function renderTemplate(tpl: string, vars: Record<string, string | undefined>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) =>
    Object.hasOwn(vars, key) ? (vars[key] ?? "") : "",
  );
}
