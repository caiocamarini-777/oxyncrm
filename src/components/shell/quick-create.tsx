"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function QuickCreate({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const items = isSuperAdmin
    ? [
        { label: "Nova empresa", href: "/configuracoes/empresas?novo=1" },
        { label: "Convidar usuário", href: "/configuracoes/usuarios?convidar=1" },
      ]
    : [];
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" aria-label="Criar">
          <Plus className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((i) => (
          <DropdownMenuItem key={i.href} asChild>
            <Link href={i.href}>{i.label}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
