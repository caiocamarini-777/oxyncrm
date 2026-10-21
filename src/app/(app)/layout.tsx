import { requireUser } from "@/lib/auth/session";

// Bloqueante de propósito: o 404 de empresa precisa sair com status 404, e não
// em um stream que já começou com 200. A página depende da sessão de qualquer forma.
export const instant = false;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return children;
}
