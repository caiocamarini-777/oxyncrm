"use client";

import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createDashboard } from "@/lib/insights/actions";
import { ENTITIES } from "@/lib/insights/meta";
import { cn } from "@/lib/utils";
import { EntityIcon } from "./entity-icon";

type Base = { empresa: string; companies: { id: string; name: string }[]; open: boolean; onOpenChange: (o: boolean) => void };

function CompanySelect({ companies, value, onChange }: { companies: Base["companies"]; value: string; onChange: (v: string) => void }) {
  if (companies.length < 2) return null;
  return (
    <div className="space-y-1">
      <Label>Empresa</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full" aria-label="Empresa">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {companies.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** "Adicionar novo relatório": escolher a entidade e o tipo de relatório (como no Pipedrive). */
export function NewReportDialog({ empresa, companies, open, onOpenChange }: Base) {
  const router = useRouter();
  const [entity, setEntity] = useState("deal");
  const [type, setType] = useState<string | null>(null);
  const [company, setCompany] = useState(companies[0]?.id ?? "");
  const e = ENTITIES.find((x) => x.key === entity)!;

  function go() {
    const t = e.types.find((x) => `${x.dataType}:${x.reportType}` === type) ?? e.types[0]!;
    onOpenChange(false);
    router.push(`/${empresa}/relatorios/r/novo?entidade=${t.dataType}&tipo=${t.reportType}&empresa_id=${company}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Adicionar novo relatório</DialogTitle>
        </DialogHeader>
        <CompanySelect companies={companies} value={company} onChange={setCompany} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Escolher entidade</p>
            <ul className="space-y-1">
              {ENTITIES.map((x) => (
                <li key={x.key}>
                  <button
                    onClick={() => {
                      setEntity(x.key);
                      setType(null);
                    }}
                    className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm", entity === x.key ? "bg-accent font-medium text-primary" : "hover:bg-accent/60")}
                  >
                    <EntityIcon icon={x.icon} className="size-4" />
                    <span className="flex-1">{x.label}</span>
                    {entity === x.key ? <ChevronRight className="size-4" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Escolher tipo de relatório</p>
            <ul className="space-y-1">
              {e.types.map((t) => {
                const key = `${t.dataType}:${t.reportType}`;
                const active = (type ?? `${e.types[0]!.dataType}:${e.types[0]!.reportType}`) === key;
                return (
                  <li key={key}>
                    <button
                      onClick={() => setType(key)}
                      onDoubleClick={go}
                      className={cn("w-full rounded-md px-3 py-2 text-left", active ? "bg-accent" : "hover:bg-accent/60")}
                    >
                      <span className="block text-sm font-medium">{t.label}</span>
                      <span className="block text-xs text-muted-foreground">{t.description}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={go} disabled={!company}>
            Continuar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NewDashboardDialog({ empresa, companies, open, onOpenChange }: Base) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [company, setCompany] = useState(companies[0]?.id ?? "");
  const [pending, start] = useTransition();

  function create() {
    start(async () => {
      const r = await createDashboard({ companyId: company, name });
      if (!r.ok) return void toast.error(r.error);
      onOpenChange(false);
      router.push(`/${empresa}/relatorios/paineis/${r.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Novo painel</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <CompanySelect companies={companies} value={company} onChange={setCompany} />
          <div className="space-y-1">
            <Label htmlFor="nome-painel">Nome</Label>
            <Input id="nome-painel" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: KPIs do time" autoFocus onKeyDown={(e) => e.key === "Enter" && name.trim() && create()} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={create} disabled={pending || !name.trim() || !company}>
            Criar painel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
