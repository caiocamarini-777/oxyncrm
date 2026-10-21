/** Regras de senha compartilhadas entre "Definir senha" e o perfil. */
export function validatePassword(password: string, confirm: string): string | null {
  if (password.length < 8) return "A senha precisa ter pelo menos 8 caracteres.";
  if (password !== confirm) return "As senhas não conferem.";
  return null;
}
