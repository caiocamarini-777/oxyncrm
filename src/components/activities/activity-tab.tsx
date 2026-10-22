"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createActivity } from "@/lib/activities/actions";
import type { RecordActivityData } from "@/lib/activities/record-context";
import { ActivityForm, type FormResult, type FormValues } from "./activity-form";
import { defaultDue, toCreateInput } from "./helpers";

export function activeTypes(data: RecordActivityData) {
  return data.catalog.types.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name, isMeeting: t.isMeeting }));
}

export function activeChannels(data: RecordActivityData) {
  return data.catalog.channels.filter((c) => c.active && !c.isLegacy).map((c) => ({ id: c.id, name: c.name }));
}

/** Aba "Atividade" do registro: formulário já vinculado ao registro atual. */
export function ActivityTab({ data }: { data: RecordActivityData }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [formKey, setFormKey] = useState(0);

  if (!data.canCreate) {
    return <p className="text-sm text-muted-foreground">Você não tem permissão para criar atividades.</p>;
  }

  async function submit(values: FormValues): Promise<FormResult> {
    const res = await createActivity(data.companyId, toCreateInput(values, data.links));
    if (!res.ok) return res;
    toast.success("Atividade criada.");
    setFormKey((k) => k + 1);
    startTransition(() => router.refresh());
    return { ok: true };
  }

  const parties = (["person", "organization"] as const).filter(
    (p) => !(p === "person" ? data.links.personId : data.links.organizationId),
  );

  return (
    <ActivityForm
      key={formKey}
      idPrefix="new-activity"
      companyId={data.companyId}
      types={activeTypes(data)}
      channels={activeChannels(data)}
      owners={data.owners}
      canReassign={data.canReassign}
      initial={{ dueAt: defaultDue(data.nowIso), ownerId: data.currentUserId }}
      parties={[...parties]}
      submitLabel="Salvar atividade"
      onSubmit={submit}
    />
  );
}
