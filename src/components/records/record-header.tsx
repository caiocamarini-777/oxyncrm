"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { LabelPicker, type LabelOption } from "@/components/records/label-picker";
import { OwnerPicker } from "@/components/records/owner-picker";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { moveToTrash, reassignOwner } from "@/lib/records/actions";
import type { AssignableOwner, RecordEntity } from "@/lib/records/types";

export type RecordNoun = {
  /** Ex.: "organização". */
  singular: string;
  /** Ex.: "Organização movida para a lixeira." */
  trashedToast: string;
  /** Ex.: "{noun.trashDescription}" */
  trashDescription: string;
};

export function RecordHeader({
  entity,
  noun,
  actions,
  id,
  companyId,
  companyName,
  listHref,
  name,
  ownerId,
  owners,
  labels,
  labelIds,
  canEdit,
  canDelete,
  canReassign,
}: {
  entity: RecordEntity;
  noun: RecordNoun;
  /** Slot ao lado do responsável (ex.: link da organização, botões de lead). */
  actions?: ReactNode;
  id: string;
  companyId: string;
  companyName: string;
  listHref: string;
  name: string;
  ownerId: string;
  owners: AssignableOwner[];
  labels: LabelOption[];
  labelIds: string[];
  canEdit: boolean;
  canDelete: boolean;
  canReassign: boolean;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();

  function trash() {
    start(async () => {
      const res = await moveToTrash(entity, id);
      if (!res.ok) {
        toast.error(res.error);
        setConfirm(false);
        return;
      }
      toast.success(noun.trashedToast);
      router.push(listHref);
    });
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        <div>
          <h1 className="font-heading text-2xl font-semibold">{name}</h1>
          <p className="text-sm text-muted-foreground">{companyName}</p>
        </div>
        <LabelPicker
          companyId={companyId}
          entity={entity}
          recordId={id}
          options={labels}
          value={labelIds}
          canEdit={canEdit}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        <div className="w-56">
          <OwnerPicker
            companyId={companyId}
            owners={owners}
            value={ownerId}
            canReassign={canReassign}
            onChange={async (next) => {
              const res = await reassignOwner(entity, id, next);
              if (res.ok) router.refresh();
              return res;
            }}
          />
        </div>
        {canDelete ? (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Mais ações">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setConfirm(true)}>
                  <Trash2 /> Mover para a lixeira
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <AlertDialog open={confirm} onOpenChange={setConfirm}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Mover para a lixeira?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {noun.trashDescription}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={pending}
                    onClick={(e) => {
                      e.preventDefault();
                      trash();
                    }}
                  >
                    Mover para a lixeira
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : null}
      </div>
    </div>
  );
}
