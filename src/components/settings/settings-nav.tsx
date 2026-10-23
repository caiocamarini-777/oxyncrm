"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

const ITEMS = [
  { href: "/configuracoes/empresas", label: "Empresas" },
  { href: "/configuracoes/usuarios", label: "Usuários" },
  { href: "/configuracoes/papeis", label: "Papéis" },
  { href: "/configuracoes/equipes", label: "Equipes" },
  { href: "/configuracoes/campos", label: "Campos" },
  { href: "/configuracoes/etiquetas", label: "Etiquetas" },
  { href: "/configuracoes/origens", label: "Origens de lead" },
  { href: "/configuracoes/motivos", label: "Motivos de desqualificação" },
  { href: "/configuracoes/funis", label: "Funis" },
  { href: "/configuracoes/produtos", label: "Produtos" },
  { href: "/configuracoes/motivos-perda", label: "Motivos de perda" },
  { href: "/configuracoes/atividades", label: "Atividades" },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Configurações" className="flex gap-1 md:w-48 md:flex-col">
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted",
              active && "bg-muted font-medium text-brand",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
