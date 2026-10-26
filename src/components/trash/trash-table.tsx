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
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/records/format";
import { purgeRecord, restoreFromTrash } from "@/lib/records/actions";
import type { RecordEntity } from "@/lib/records/types";
import type { TrashRow } from "@/lib/trash/queries";

export function TrashTable({
  entity,
  rows,
  allCompanies,
  deletableCompanyIds,
  isSuperAdmin,
}: {
  entity: RecordEntity;
  rows: TrashRow[];
  allCompanies: boolean;
  deletableCompanyIds: string[];
  isSuperAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [purging, setPurging] = useState<TrashRow | null>(null);

  function restore(row: TrashRow) {
    start(async () => {
      const res = await restoreFromTrash(entity, row.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Registro restaurado.");
      router.refresh();
    });
  }

  function purge() {
    if (!purging) return;
    const row = purging;
    start(async () => {
      const res = await purgeRecord(entity, row.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Registro excluído definitivamente.");
      setPurging(null);
      router.refresh();
    });
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            {allCompanies ? <TableHead>Empresa</TableHead> : null}
            <TableHead>Responsável</TableHead>
            <TableHead>Excluído em</TableHead>
            <TableHead>Exclusão definitiva em</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={allCompanies ? 6 : 5} className="py-8 text-center text-muted-foreground">
                A lixeira está vazia.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                {allCompanies ? <TableCell>{r.companyName}</TableCell> : null}
                <TableCell>{r.ownerName}</TableCell>
                <TableCell>{formatDate(r.deletedAt)}</TableCell>
                <TableCell>{formatDate(r.purgeAt)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {deletableCompanyIds.includes(r.companyId) ? (
                      <Button variant="outline" size="sm" disabled={pending} onClick={() => restore(r)}>
                        Restaurar
                      </Button>
                    ) : null}
                    {isSuperAdmin ? (
                      <Button variant="destructive" size="sm" disabled={pending} onClick={() => setPurging(r)}>
                        Excluir definitivamente
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <AlertDialog open={purging !== null} onOpenChange={(o) => !o && setPurging(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir definitivamente?</AlertDialogTitle>
            <AlertDialogDescription>
              {`Excluir ${purging?.name ?? ""} para sempre? Esta ação não pode ser desfeita.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                purge();
              }}
            >
              Excluir definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
