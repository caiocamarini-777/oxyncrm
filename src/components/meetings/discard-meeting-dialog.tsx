"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
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
import { discardMeeting } from "@/lib/meet/actions";

/**
 * Confirmação de "Descartar reunião". Aberta enquanto `meeting` não é nulo; `onOpenChange(false)` fecha (o pai
 * zera a reunião). Usada pela página Reuniões e pela tela inicial. O servidor confere a permissão de novo.
 */
export function DiscardMeetingDialog({
  meeting,
  onOpenChange,
}: {
  meeting: { id: string; title: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function discard() {
    if (!meeting) return;
    const target = meeting;
    start(async () => {
      const res = await discardMeeting(target.id);
      if (!res.ok) {
        toast.error(res.error);
        router.refresh();
        return;
      }
      toast.success("Reunião descartada.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <AlertDialog open={meeting !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Descartar reunião?</AlertDialogTitle>
          <AlertDialogDescription>
            {`A transcrição, as notas e as sugestões de “${meeting?.title ?? ""}” serão apagadas. Esta ação não pode ser desfeita.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              discard();
            }}
          >
            Descartar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
