"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { createActivity } from "@/lib/activities/actions";
import { ActivityForm, type FormResult, type FormValues } from "./activity-form";
import { defaultDue, toCreateInput } from "./helpers";
import type { PageCtx } from "./page-context";

const NO_LINKS = { leadId: null, dealId: null, personId: null, organizationId: null };

/** "Nova atividade": o formulário exige uma pessoa ou organização como vínculo. */
export function NewActivityDialog({ ctx }: { ctx: PageCtx }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const creatable = ctx.companies.filter((c) => c.canCreate);
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState(creatable[0]?.id ?? "");
  const [formKey, setFormKey] = useState(0);
  if (creatable.length === 0) return null;
  const company = creatable.find((c) => c.id === companyId) ?? creatable[0];

  async function submit(v: FormValues): Promise<FormResult> {
    const personId = v.person?.id ?? null;
    const organizationId = v.organization?.id ?? null;
    if (!personId && !organizationId) {
      const error = "Escolha uma pessoa ou organização para vincular a atividade.";
      return { ok: false, error, fieldErrors: { links: error } };
    }
    const res = await createActivity(company.id, toCreateInput(v, NO_LINKS));
    if (!res.ok) return res;
    toast.success("Atividade criada.");
    setOpen(false);
    setFormKey((k) => k + 1);
    startTransition(() => router.refresh());
    return { ok: true };
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Nova atividade
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Nova atividade</DialogTitle>
            <DialogDescription>Vincule a atividade a uma pessoa ou organização.</DialogDescription>
          </DialogHeader>
          {creatable.length > 1 ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-activity-company">Empresa</Label>
              <select
                id="new-activity-company"
                value={company.id}
                onChange={(e) => {
                  setCompanyId(e.target.value);
                  setFormKey((k) => k + 1);
                }}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {creatable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <ActivityForm
            key={`${company.id}-${formKey}`}
            idPrefix="page-new"
            companyId={company.id}
            types={company.catalog.types.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name, isMeeting: t.isMeeting }))}
            channels={company.catalog.channels.filter((c) => c.active && !c.isLegacy).map((c) => ({ id: c.id, name: c.name }))}
            owners={company.owners}
            canReassign={company.canReassign}
            initial={{ dueAt: defaultDue(ctx.nowIso), ownerId: ctx.currentUserId }}
            parties={["person", "organization"]}
            submitLabel="Salvar atividade"
            onCancel={() => setOpen(false)}
            onSubmit={submit}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
