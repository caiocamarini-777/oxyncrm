"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createRole, deleteRole } from "@/lib/roles/actions";

export type RoleListItem = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  usage: number;
};

export function RolesTable({ roles }: { roles: RoleListItem[] }) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<RoleListItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    startTransition(async () => {
      const result = await deleteRole(target.id);
      if (result.ok) {
        setDeleting(null);
        router.refresh();
      } else {
        setDeleteError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold">Papéis</h1>
        <Button onClick={() => setCreateOpen(true)}>Novo papel</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Descrição</TableHead>
            <TableHead>Acessos usando o papel</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles.map((r) => (
            <TableRow key={r.id} data-testid={`role-${r.id}`}>
              <TableCell className="font-medium">
                <span className="mr-2">{r.name}</span>
                {r.isSystem ? <Badge variant="secondary">Padrão do sistema</Badge> : null}
              </TableCell>
              <TableCell className="whitespace-normal text-muted-foreground">
                {r.description}
              </TableCell>
              <TableCell>{r.usage}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/configuracoes/papeis/${r.id}`}>Editar</Link>
                  </Button>
                  {r.isSystem ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleting(r);
                      }}
                    >
                      Excluir
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <CreateBody key={String(createOpen)} close={() => setCreateOpen(false)} />
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button disabled={pending} onClick={confirmDelete}>
              Confirmar exclusão
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateBody({ close }: { close: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const result = await createRole({ name, description });
      if (result.ok) {
        close();
        router.push(`/configuracoes/papeis/${result.data.id}`);
      } else {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.fieldErrors ? null : result.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Novo papel</DialogTitle>
        <DialogDescription>
          O papel nasce com as permissões do usuário padrão. Ajuste na tela seguinte.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role-name">Nome</Label>
        <Input
          id="role-name"
          value={name}
          aria-invalid={Boolean(errors.name)}
          onChange={(e) => setName(e.target.value)}
        />
        {errors.name ? (
          <p role="alert" className="text-sm text-destructive">
            {errors.name}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role-description">Descrição</Label>
        <Textarea
          id="role-description"
          value={description}
          aria-invalid={Boolean(errors.description)}
          onChange={(e) => setDescription(e.target.value)}
        />
        {errors.description ? (
          <p role="alert" className="text-sm text-destructive">
            {errors.description}
          </p>
        ) : null}
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
          {pending ? "Criando..." : "Criar papel"}
        </Button>
      </DialogFooter>
    </form>
  );
}
