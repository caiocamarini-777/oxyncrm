"use client";

import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { UserRow } from "@/lib/users/actions";
import type { NamedOption } from "./access-rows";
import { InviteUserDialog } from "./invite-user-dialog";
import { UserDrawer } from "./user-drawer";

type Status = "active" | "pending" | "inactive";

function statusOf(u: UserRow): Status {
  if (!u.active) return "inactive";
  return u.pending ? "pending" : "active";
}

const STATUS_LABEL: Record<Status, string> = {
  active: "Ativo",
  pending: "Convite pendente",
  inactive: "Inativo",
};

function initials(name: string, email: string) {
  return (name.trim() || email)
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function UsersTable({
  users,
  currentUserId,
  companies,
  roles,
  teams,
  openInvite,
}: {
  users: UserRow[];
  currentUserId: string;
  companies: NamedOption[];
  roles: NamedOption[];
  teams: NamedOption[];
  openInvite: boolean;
}) {
  const [inviteOpen, setInviteOpen] = useState(openInvite);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [company, setCompany] = useState("all");
  const [status, setStatus] = useState("all");

  const shown = users.filter(
    (u) =>
      (company === "all" || u.access.some((a) => a.companyId === company)) &&
      (status === "all" || statusOf(u) === status),
  );
  const editing = users.find((u) => u.id === editingId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold">Usuários</h1>
        <Button onClick={() => setInviteOpen(true)}>Convidar usuário</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={company} onValueChange={setCompany}>
          <SelectTrigger aria-label="Filtrar por empresa">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as empresas</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filtrar por status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="active">Ativo</SelectItem>
            <SelectItem value="pending">Convite pendente</SelectItem>
            <SelectItem value="inactive">Inativo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>E-mail</TableHead>
            <TableHead>Empresas e papéis</TableHead>
            <TableHead>Equipes</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
                Nenhum usuário encontrado.
              </TableCell>
            </TableRow>
          ) : (
            shown.map((u) => (
              <TableRow key={u.id} data-testid="user-row">
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar size="sm">
                      {u.avatarUrl ? <AvatarImage src={u.avatarUrl} alt="" /> : null}
                      <AvatarFallback>{initials(u.fullName, u.email)}</AvatarFallback>
                    </Avatar>
                    <span className="font-medium">{u.fullName || u.email}</span>
                    {u.isSuperAdmin ? <Badge variant="outline">Admin geral</Badge> : null}
                  </div>
                </TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  {u.access.length === 0
                    ? "-"
                    : u.access.map((a) => `${a.companyName} · ${a.roleName}`).join(", ")}
                </TableCell>
                <TableCell>{u.teams.map((t) => t.name).join(", ") || "-"}</TableCell>
                <TableCell>
                  <Badge variant={statusOf(u) === "active" ? "default" : "secondary"}>
                    {STATUS_LABEL[statusOf(u)]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Editar ${u.fullName || u.email}`}
                    onClick={() => setEditingId(u.id)}
                  >
                    Editar
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <InviteUserDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        companies={companies}
        roles={roles}
        teams={teams}
      />
      <UserDrawer
        user={editing}
        currentUserId={currentUserId}
        companies={companies}
        roles={roles}
        teams={teams}
        onClose={() => setEditingId(null)}
      />
    </div>
  );
}
