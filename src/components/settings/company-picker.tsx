"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Label } from "@/components/ui/label";

export function SettingsCompanyPicker({
  companies,
  selected,
}: {
  companies: { slug: string; name: string }[];
  selected: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function change(slug: string) {
    const next = new URLSearchParams(params.toString());
    next.set("empresa", slug);
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="settings-company" className="text-sm text-muted-foreground">
        Empresa
      </Label>
      <select
        id="settings-company"
        value={selected}
        onChange={(e) => change(e.target.value)}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      >
        {companies.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function NoCompany() {
  return <p className="text-sm text-muted-foreground">Nenhuma empresa disponível. Cadastre uma empresa primeiro.</p>;
}
