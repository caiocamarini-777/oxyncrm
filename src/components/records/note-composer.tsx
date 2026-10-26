"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addNote } from "@/lib/notes/actions";
import type { RecordEntity } from "@/lib/records/types";

export function NoteComposer({ entity, recordId }: { entity: RecordEntity; recordId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();
  const empty = body.trim().length === 0;

  async function save() {
    if (empty || saving) return;
    setSaving(true);
    try {
      const res = await addNote(entity, recordId, body);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setBody("");
      startTransition(() => router.refresh());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label="Anotação"
        placeholder="Escreva uma anotação"
        rows={4}
        maxLength={10000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void save();
          }
        }}
      />
      <div className="flex justify-end">
        <Button type="button" disabled={empty || saving} onClick={() => void save()}>
          Salvar anotação
        </Button>
      </div>
    </div>
  );
}
