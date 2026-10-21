"use client";

import { useState, useTransition } from "react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useCloseAfterSave } from "@/lib/use-close-after-save";
import { createTeam, deleteTeam, renameTeam, setTeamMembers } from "@/lib/teams/actions";

export type PersonOption = { id: string; name: string; email: string; avatarUrl: string | null; active: boolean };
export type TeamItem = { id: string; name: string; members: PersonOption[] };

const MAX_AVATARS = 5;

function initials(name: string, email: string) {
  const source = name.trim() || email;
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function peopleLabel(n: number) {
  return `${n} ${n === 1 ? "pessoa" : "pessoas"}`;
}

export function TeamsManager({ teams, people }: { teams: TeamItem[]; people: PersonOption[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<TeamItem | "new" | null>(null);
  const [deleting, setDeleting] = useState<TeamItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    startTransition(async () => {
      const result = await deleteTeam(target.id);
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
        <h1 className="font-heading text-2xl font-semibold">Equipes</h1>
        <Button onClick={() => setEditing("new")}>Nova equipe</Button>
      </div>

      {teams.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma equipe cadastrada.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {teams.map((t) => (
            <Card key={t.id} data-testid="team-card">
              <CardHeader>
                <CardTitle className="font-heading">{t.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-3">
                <div className="flex -space-x-2">
                  {t.members.slice(0, MAX_AVATARS).map((m) => (
                    <Avatar key={m.id} size="sm" title={m.name || m.email}>
                      {m.avatarUrl ? <AvatarImage src={m.avatarUrl} alt="" /> : null}
                      <AvatarFallback>{initials(m.name, m.email)}</AvatarFallback>
                    </Avatar>
                  ))}
                </div>
                <span className="text-sm text-muted-foreground">
                  {peopleLabel(t.members.length)}
                </span>
              </CardContent>
              <CardFooter className="gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(t)}>
                  Editar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDeleteError(null);
                    setDeleting(t);
                  }}
                >
                  Excluir
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing ? (
            <TeamForm
              key={editing === "new" ? "new" : editing.id}
              team={editing === "new" ? null : editing}
              people={people}
              close={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              A visibilidade &quot;Da minha equipe&quot; deixa de considerar esse grupo.
            </AlertDialogDescription>
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

function TeamForm({
  team,
  people,
  close,
}: {
  team: TeamItem | null;
  people: PersonOption[];
  close: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const markSaved = useCloseAfterSave(pending, close);
  const [teamId, setTeamId] = useState<string | null>(team?.id ?? null);
  const [name, setName] = useState(team?.name ?? "");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(team?.members.map((m) => m.id) ?? []),
  );
  const [query, setQuery] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const memberIds = new Set(team?.members.map((m) => m.id) ?? []);
  const pool = people.filter((p) => p.active || memberIds.has(p.id));
  const visible = q
    ? pool.filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
    : pool;

  function toggle(id: string, checked: boolean) {
    if (!people.find((p) => p.id === id)?.active) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setNameError(null);
    setFormError(null);
    startTransition(async () => {
      let id = teamId;
      if (id === null) {
        const created = await createTeam({ name });
        if (!created.ok) {
          if (created.fieldErrors?.name) setNameError(created.fieldErrors.name);
          else setFormError(created.error);
          return;
        }
        id = created.data.id;
        setTeamId(id);
      } else if (name.trim() !== (team?.name ?? "")) {
        const renamed = await renameTeam(id, name);
        if (!renamed.ok) {
          if (renamed.fieldErrors?.name) setNameError(renamed.fieldErrors.name);
          else setFormError(renamed.error);
          return;
        }
      }
      const result = await setTeamMembers(id, [...selected]);
      router.refresh();
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      markSaved();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{team ? "Editar equipe" : "Nova equipe"}</DialogTitle>
        <DialogDescription>Defina o nome e quem faz parte da equipe.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="team-name">Nome da equipe</Label>
        <Input
          id="team-name"
          value={name}
          aria-invalid={Boolean(nameError)}
          onChange={(e) => setName(e.target.value)}
        />
        {nameError ? (
          <p role="alert" className="text-sm text-destructive">
            {nameError}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="team-search">Buscar pessoas</Label>
        <Input
          id="team-search"
          placeholder="Nome ou e-mail"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="max-h-56 overflow-y-auto rounded-md border">
          {visible.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">Ninguém encontrado.</li>
          ) : (
            visible.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-brand)]"
                    checked={selected.has(p.id)}
                    disabled={!p.active}
                    onChange={(e) => toggle(p.id, e.target.checked)}
                    aria-label={`${p.name || p.email} ${p.email}`}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      {p.name || p.email}
                      {p.active ? "" : " (inativo)"}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{p.email}</span>
                  </span>
                </label>
              </li>
            ))
          )}
        </ul>
        <p className="text-xs text-muted-foreground">{selected.size} {selected.size === 1 ? "selecionada" : "selecionadas"}</p>
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
          {pending ? "Salvando..." : "Salvar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
