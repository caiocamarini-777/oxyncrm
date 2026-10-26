"use client";

import { useCloseAfterSave } from "@/lib/use-close-after-save";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  resendInvite,
  setSuperAdmin,
  setUserAccess,
  setUserActive,
  setUserTeams,
  type UserRow,
} from "@/lib/users/actions";
import { AccessRows, TeamPicker, type AccessDraft, type NamedOption } from "./access-rows";

const SELF_HINT = "Você não pode alterar o seu próprio acesso.";

export function UserDrawer({
  user,
  currentUserId,
  companies,
  roles,
  teams,
  onClose,
}: {
  user: UserRow | null;
  currentUserId: string;
  companies: NamedOption[];
  roles: NamedOption[];
  teams: NamedOption[];
  onClose: () => void;
}) {
  return (
    <Sheet open={user !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        {user ? (
          <DrawerBody
            key={user.id}
            user={user}
            self={user.id === currentUserId}
            companies={companies}
            roles={roles}
            teams={teams}
            close={onClose}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({
  user,
  self,
  companies,
  roles,
  teams,
  close,
}: {
  user: UserRow;
  self: boolean;
  companies: NamedOption[];
  roles: NamedOption[];
  teams: NamedOption[];
  close: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const markSaved = useCloseAfterSave(pending, close);
  const [isSuperAdmin, setIsSuperAdmin] = useState(user.isSuperAdmin);
  const [access, setAccess] = useState<AccessDraft[]>(
    user.access.map((a) => ({ companyId: a.companyId, roleId: a.roleId })),
  );
  const [teamIds, setTeamIds] = useState<Set<string>>(new Set(user.teams.map((t) => t.id)));
  const [error, setError] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function save() {
    setError(null);
    setAccessError(null);
    if (access.some((r) => !r.companyId || !r.roleId)) {
      setAccessError("Escolha a empresa e o papel em cada linha.");
      return;
    }
    if (!isSuperAdmin && access.length === 0) {
      setAccessError("Libere o acesso a pelo menos uma empresa.");
      return;
    }
    startTransition(async () => {
      if (isSuperAdmin !== user.isSuperAdmin) {
        const r = await setSuperAdmin(user.id, isSuperAdmin);
        if (!r.ok) return setError(r.error);
      }
      const a = await setUserAccess(user.id, access);
      if (!a.ok) {
        router.refresh();
        return setError(a.error);
      }
      const t = await setUserTeams(user.id, [...teamIds]);
      router.refresh();
      if (!t.ok) return setError(t.error);
      toast.success("Alterações salvas.");
      markSaved();
    });
  }

  function toggleActive(active: boolean) {
    startTransition(async () => {
      const r = await setUserActive(user.id, active);
      setConfirming(false);
      if (!r.ok) return setError(r.error);
      router.refresh();
      markSaved();
    });
  }

  function resend() {
    startTransition(async () => {
      const r = await resendInvite(user.id);
      if (r.ok) toast.success("Convite reenviado.");
      else setError(r.error);
    });
  }

  const deactivate = (
    <Button
      type="button"
      variant="outline"
      disabled={self || pending}
      onClick={() => (user.active ? setConfirming(true) : toggleActive(true))}
    >
      {user.active ? "Desativar acesso" : "Reativar acesso"}
    </Button>
  );

  return (
    <>
      <SheetHeader>
        <SheetTitle>{user.fullName || user.email}</SheetTitle>
        <SheetDescription>Edite o acesso desta pessoa.</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-4 px-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="drawer-email">E-mail</Label>
          <Input id="drawer-email" value={user.email} readOnly />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="drawer-super">Administrador geral</Label>
          {self ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Switch id="drawer-super" checked={isSuperAdmin} disabled />
                </span>
              </TooltipTrigger>
              <TooltipContent>{SELF_HINT}</TooltipContent>
            </Tooltip>
          ) : (
            <Switch id="drawer-super" checked={isSuperAdmin} onCheckedChange={setIsSuperAdmin} />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Empresas e papéis
          </span>
          <AccessRows
            value={access}
            onChange={setAccess}
            companies={companies}
            roles={roles}
            error={accessError}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Equipes
          </span>
          <TeamPicker teams={teams} selected={teamIds} onChange={setTeamIds} />
        </div>
        <div className="flex flex-wrap gap-2">
          {user.pending ? (
            <Button type="button" variant="outline" disabled={pending} onClick={resend}>
              Reenviar convite
            </Button>
          ) : null}
          {self ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>{deactivate}</span>
              </TooltipTrigger>
              <TooltipContent>{SELF_HINT}</TooltipContent>
            </Tooltip>
          ) : (
            deactivate
          )}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <SheetFooter className="flex-row justify-end gap-2">
        <Button type="button" variant="outline" onClick={close}>
          Cancelar
        </Button>
        <Button type="button" disabled={pending} onClick={save}>
          {pending ? "Salvando..." : "Salvar"}
        </Button>
      </SheetFooter>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar {user.fullName || user.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              A pessoa perde o acesso na hora. Os registros dela continuam no sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button disabled={pending} onClick={() => toggleActive(false)}>
              Confirmar desativação
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
