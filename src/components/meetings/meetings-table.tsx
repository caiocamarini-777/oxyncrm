"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/activities/time";
import { discardMeeting, retryMeeting } from "@/lib/meet/actions";
import { canDiscard, canRetry } from "@/lib/meet/decisions";
import type { MeetingListRow } from "@/lib/meet/queries";
import { meetingSituation, type MeetingListTab } from "@/lib/meet/view";
import { cn } from "cn";
import { LinkMeetingDialog } from "./link-meeting-dialog";

const EMPTY: Record<MeetingListTab, string> = {
  pendentes: "Nenhuma sugestão esperando decisão.",
  "sem-vinculo": "Nenhuma reunião sem vínculo.",
  "com-erro": "Nenhuma reunião com erro.",
  todas: "Nenhuma reunião ainda.",
};

const ENTITY_LABEL = { deals: "Negócio", leads: "Lead", persons: "Pessoa", organizations: "Organização" } as const;

const MAX_ERROR_CHARS = 160;

/**
 * Lista da página Reuniões. Ações por linha, só para o dono (ou admin geral): Vincular e Descartar nas sem
 * vínculo, Descartar e Tentar de novo nas com erro. O servidor confere a permissão de novo em cada ação.
 */
export function MeetingsTable({
  rows,
  tab,
  allCompanies,
}: {
  rows: MeetingListRow[];
  tab: MeetingListTab;
  allCompanies: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [linking, setLinking] = useState<MeetingListRow | null>(null);
  const [discarding, setDiscarding] = useState<MeetingListRow | null>(null);
  const columns = allCompanies ? 7 : 6;

  function retry(row: MeetingListRow) {
    start(async () => {
      const res = await retryMeeting(row.id);
      if (!res.ok) toast.error(res.error);
      else toast.success("Reunião processada.");
      router.refresh();
    });
  }

  function discard() {
    if (!discarding) return;
    const row = discarding;
    start(async () => {
      const res = await discardMeeting(row.id);
      if (!res.ok) {
        toast.error(res.error);
        router.refresh();
        return;
      }
      toast.success("Reunião descartada.");
      setDiscarding(null);
      router.refresh();
    });
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Reunião</TableHead>
            <TableHead>Data</TableHead>
            <TableHead>Dono</TableHead>
            {allCompanies ? <TableHead>Empresa</TableHead> : null}
            <TableHead>Registro</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns} className="py-8 text-center text-muted-foreground">
                {EMPTY[tab]}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => {
              const unlinked = r.tab === "sem-vinculo";
              const showLink = r.canAct && unlinked;
              const showDiscard = r.canAct && canDiscard(r.status, r.recordTrashed);
              const showRetry = r.canAct && canRetry(r.status);
              return (
                <TableRow key={r.id} data-testid="meeting-row" data-overdue={r.overdue ? "true" : undefined} className={cn(r.overdue && "bg-destructive/5")}>
                  <TableCell className="max-w-72 whitespace-normal">
                    <span className="font-medium break-words">{r.title}</span>
                    {r.status === "failed" && r.lastError ? (
                      <p className="mt-0.5 text-xs break-words text-muted-foreground">
                        {r.lastError.length > MAX_ERROR_CHARS ? `${r.lastError.slice(0, MAX_ERROR_CHARS)}…` : r.lastError}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(r.startedAt)}</TableCell>
                  <TableCell>{r.ownerName}</TableCell>
                  {allCompanies ? <TableCell>{r.companyName}</TableCell> : null}
                  <TableCell className="max-w-56 whitespace-normal">
                    {r.record ? (
                      <Link href={r.record.href} className="break-words underline-offset-3 hover:underline">
                        <span className="text-xs text-muted-foreground">{ENTITY_LABEL[r.record.entity]}: </span>
                        {r.record.title || "Sem nome"}
                      </Link>
                    ) : r.recordTrashed ? (
                      <span className="text-muted-foreground">Registro na lixeira</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm">{meetingSituation(r.status, r.tab)}</span>
                      {r.suggestionsPending > 0 && r.tab === "pendentes" ? (
                        <span className="text-xs text-muted-foreground">({r.suggestionsPending})</span>
                      ) : null}
                      {r.overdue ? <Badge variant="destructive">Há mais de 24 h</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {showLink ? (
                        <Button variant="outline" size="sm" disabled={pending} onClick={() => setLinking(r)}>
                          Vincular
                        </Button>
                      ) : null}
                      {showRetry ? (
                        <Button variant="outline" size="sm" disabled={pending} onClick={() => retry(r)}>
                          Tentar de novo
                        </Button>
                      ) : null}
                      {showDiscard ? (
                        <Button variant="destructive" size="sm" disabled={pending} onClick={() => setDiscarding(r)}>
                          Descartar
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      {linking ? (
        <LinkMeetingDialog
          meeting={{
            id: linking.id,
            title: linking.title,
            companyId: linking.companyId,
            companyName: linking.companyName,
            companySlug: linking.companySlug,
          }}
          open
          onOpenChange={(o) => !o && setLinking(null)}
        />
      ) : null}
      <AlertDialog open={discarding !== null} onOpenChange={(o) => !o && setDiscarding(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar reunião?</AlertDialogTitle>
            <AlertDialogDescription>
              {`A transcrição, as notas e as sugestões de “${discarding?.title ?? ""}” serão apagadas. Esta ação não pode ser desfeita.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                discard();
              }}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
