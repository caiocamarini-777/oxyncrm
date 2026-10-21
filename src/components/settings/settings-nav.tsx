"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

const ITEMS = [
  { href: "/configuracoes/empresas", label: "Empresas" },
  { href: "/configuracoes/usuarios", label: "Usuários" },
  { href: "/configuracoes/papeis", label: "Papéis" },
  { href: "/configuracoes/equipes", label: "Equipes" },
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
