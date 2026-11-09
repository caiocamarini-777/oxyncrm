// Confere se uma URL de banco é do projeto Supabase de testes (pooler: usuário postgres.<ref>; direta: db.<ref>.supabase.co).
export function isTestProjectUrl(url: string, ref: string): boolean {
  if (!/^[a-z0-9]{20}$/.test(ref)) return false;
  try {
    const u = new URL(url);
    return decodeURIComponent(u.username) === `postgres.${ref}` || u.hostname === `db.${ref}.supabase.co`;
  } catch {
    return false;
  }
}
