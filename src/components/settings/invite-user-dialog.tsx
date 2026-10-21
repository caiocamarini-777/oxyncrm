"use client";

import { useCloseAfterSave } from "@/lib/use-close-after-save";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { inviteUser } from "@/lib/users/actions";
import { AccessRows, TeamPicker, type AccessDraft, type NamedOption } from "./access-rows";

export function InviteUserDialog({
  open,
  onOpenChange,
  companies,
  roles,
  teams,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: NamedOption[];
  roles: NamedOption[];
  teams: NamedOption[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        {open ? (
          <InviteForm
            companies={companies}
            roles={roles}
            teams={teams}
            close={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({
  companies,
  roles,
  teams,
  close,
}: {
  companies: NamedOption[];
  roles: NamedOption[];
  teams: NamedOption[];
  close: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const markSaved = useCloseAfterSave(pending, close);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [access, setAccess] = useState<AccessDraft[]>([{ companyId: "", roleId: "" }]);
  const [teamIds, setTeamIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    const rows = access.filter((r) => r.companyId || r.roleId);
    if (rows.some((r) => !r.companyId || !r.roleId)) {
      setErrors({ access: "Escolha a empresa e o papel em cada linha." });
      return;
    }
    startTransition(async () => {
      const result = await inviteUser({
        email,
        fullName,
        isSuperAdmin,
        access: rows,
        teamIds: [...teamIds],
      });
      if (result.ok) {
        toast.success("Convite enviado.");
        router.refresh();
        markSaved();
      } else {
        setErrors(result.fieldErrors ?? {});
        if (!result.fieldErrors) setFormError(result.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Convidar usuário</DialogTitle>
        <DialogDescription>
          A pessoa recebe um e-mail para criar a senha e entrar.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-name">Nome</Label>
        <Input
          id="invite-name"
          value={fullName}
          aria-invalid={Boolean(errors.fullName)}
          onChange={(e) => setFullName(e.target.value)}
        />
        {errors.fullName ? (
          <p role="alert" className="text-sm text-destructive">
            {errors.fullName}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-email">E-mail</Label>
        <Input
          id="invite-email"
          type="email"
          value={email}
          aria-invalid={Boolean(errors.email)}
          onChange={(e) => setEmail(e.target.value)}
        />
        {errors.email ? (
          <p role="alert" className="text-sm text-destructive">
            {errors.email}
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="invite-super">Administrador geral</Label>
        <Switch id="invite-super" checked={isSuperAdmin} onCheckedChange={setIsSuperAdmin} />
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
          error={errors.access}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Equipes
        </span>
        <TeamPicker teams={teams} selected={teamIds} onChange={setTeamIds} />
      </div>
      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Enviando..." : "Enviar convite"}
        </Button>
      </DialogFooter>
    </form>
  );
}
