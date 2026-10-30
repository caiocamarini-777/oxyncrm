"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { setCompanyArchived, setCompanyFinanceEnabled } from "@/lib/companies/actions";
import { formatCnpj } from "@/lib/companies/cnpj";
import { CompanyForm, type CompanyRow } from "./company-form";

export type CompanyListItem = CompanyRow & { members: number; archived: boolean; financeEnabled: boolean };

export function CompaniesTable({
  companies,
  openNew,
}: {
  companies: CompanyListItem[];
  openNew: boolean;
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(openNew);
  const [editing, setEditing] = useState<CompanyRow | null>(null);
  const [archiving, setArchiving] = useState<CompanyListItem | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleArchive(c: CompanyListItem, archived: boolean) {
    startTransition(async () => {
      const result = await setCompanyArchived(c.id, archived);
      setArchiving(null);
      if (result.ok) router.refresh();
      else toast.error(result.error);
    });
  }

  function toggleFinance(c: CompanyListItem, enabled: boolean) {
    startTransition(async () => {
      const result = await setCompanyFinanceEnabled(c.id, enabled);
      if (result.ok) router.refresh();
      else toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold">Empresas</h1>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          Nova empresa
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>CNPJ</TableHead>
            <TableHead>Pessoas com acesso</TableHead>
            <TableHead>Financeiro ativo</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {companies.map((c) => (
            <TableRow key={c.id} data-testid={`company-${c.slug}`}>
              <TableCell className="font-medium">{c.name}</TableCell>
              <TableCell>{c.slug}</TableCell>
              <TableCell>{c.cnpj ? formatCnpj(c.cnpj) : ""}</TableCell>
              <TableCell>{c.members}</TableCell>
              <TableCell>
                <Switch
                  aria-label={`Financeiro ativo em ${c.name}`}
                  checked={c.financeEnabled}
                  disabled={pending}
                  onCheckedChange={(v) => toggleFinance(c, v)}
                />
              </TableCell>
              <TableCell>
                <Badge variant={c.archived ? "secondary" : "default"}>
                  {c.archived ? "Arquivada" : "Ativa"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(c);
                      setFormOpen(true);
                    }}
                  >
                    Editar
                  </Button>
                  {c.archived ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => toggleArchive(c, false)}
                    >
                      Reativar
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setArchiving(c)}>
                      Arquivar
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <CompanyForm open={formOpen} onOpenChange={setFormOpen} company={editing} />

      <AlertDialog open={archiving !== null} onOpenChange={(o) => !o && setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Arquivar {archiving?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              A empresa some do seletor e ninguém consegue abrir suas páginas. Você pode reativá-la aqui depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                if (archiving) toggleArchive(archiving, true);
              }}
            >
              Arquivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
