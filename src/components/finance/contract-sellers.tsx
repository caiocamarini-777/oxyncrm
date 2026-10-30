"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setContractSellers } from "@/lib/finance/sales-actions";

/** Vendedores autorizados de um contrato com linha de comissão; sem nenhum marcado, vale para todos os vendedores. */
export function ContractSellers({
  contractId,
  members,
  selected,
}: {
  contractId: string;
  members: { id: string; name: string }[];
  selected: string[];
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<string[]>(selected);
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  async function save() {
    setBusy(true);
    const r = await setContractSellers(contractId, chosen);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("Vendedores salvos.");
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Vendedores autorizados">
      <h2 className="font-heading text-base font-semibold">Vendedores autorizados</h2>
      <p className="text-sm text-muted-foreground">
        Quem pode registrar vendas de clientes neste contrato. Sem ninguém marcado, qualquer vendedor da empresa pode.
      </p>
      <ul className="flex flex-col gap-1">
        {members.map((m) => (
          <li key={m.id}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={chosen.includes(m.id)} onChange={() => toggle(m.id)} />
              {m.name}
            </label>
          </li>
        ))}
      </ul>
      <div>
        <Button type="button" size="sm" disabled={busy} onClick={save}>
          {busy ? "Salvando…" : "Salvar vendedores"}
        </Button>
      </div>
    </section>
  );
}
