"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PERMISSION_LABELS } from "@/lib/permissions/labels";
import {
  ACTIONS,
  ENTITIES,
  SETTINGS,
  VISIBILITY,
  type Permissions,
} from "@/lib/permissions/schema";
import { updateRole } from "@/lib/roles/actions";

export type RoleDetail = {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: Permissions;
};

export function RoleEditor({ role }: { role: RoleDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);
  const [permissions, setPermissions] = useState<Permissions>(role.permissions);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const dirty =
    name !== role.name ||
    description !== role.description ||
    JSON.stringify(permissions) !== JSON.stringify(role.permissions);

  function save() {
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const result = await updateRole(role.id, { name, description, permissions });
      if (result.ok) {
        toast.success("Alterações salvas.");
        router.refresh();
      } else {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.fieldErrors ? null : result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold">{role.name}</h1>
        <Button disabled={!dirty || pending} onClick={save}>
          {pending ? "Salvando..." : "Salvar alterações"}
        </Button>
      </div>
      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}

      <section className="flex max-w-xl flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role-name">Nome</Label>
          <Input
            id="role-name"
            value={name}
            disabled={role.isSystem}
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
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold">Visibilidade</h2>
        <p className="text-sm text-muted-foreground">
          Quais registros cada pessoa com este papel enxerga.
        </p>
        <div className="flex flex-col divide-y rounded-lg border">
          {ENTITIES.map((entity) => (
            <div
              key={entity}
              className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-sm font-medium">{PERMISSION_LABELS.entities[entity]}</span>
              <ToggleGroup
                type="single"
                variant="outline"
                aria-label={`Visibilidade de ${PERMISSION_LABELS.entities[entity]}`}
                value={permissions.visibility[entity]}
                onValueChange={(v) => {
                  if (!v) return;
                  setPermissions((p) => ({
                    ...p,
                    visibility: { ...p.visibility, [entity]: v as (typeof VISIBILITY)[number] },
                  }));
                }}
              >
                {VISIBILITY.map((v) => (
                  <ToggleGroupItem key={v} value={v}>
                    {PERMISSION_LABELS.visibility[v]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold">Ações</h2>
        <div className="flex flex-col divide-y rounded-lg border">
          {ACTIONS.map((key) => (
            <SwitchRow
              key={key}
              id={`action-${key}`}
              label={PERMISSION_LABELS.actions[key]}
              checked={permissions.actions[key]}
              onChange={(c) =>
                setPermissions((p) => ({ ...p, actions: { ...p.actions, [key]: c } }))
              }
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold">Configurações</h2>
        <div className="flex flex-col divide-y rounded-lg border">
          {SETTINGS.map((key) => (
            <SwitchRow
              key={key}
              id={`setting-${key}`}
              label={PERMISSION_LABELS.settings[key]}
              checked={permissions.settings[key] ?? false}
              onChange={(c) =>
                setPermissions((p) => ({ ...p, settings: { ...p.settings, [key]: c } }))
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function SwitchRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between p-3">
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
