import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

/** Sem nenhum saldo informado não há projeção: pede o saldo em vez de mostrar R$ 0 como se fosse real. */
export function BalanceMissing({ empresa, canManage }: { empresa: string; canManage: boolean }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6" role="status">
      <p className="text-sm">Informe o saldo de pelo menos uma conta para ver a projeção.</p>
      {canManage ? (
        <Link href={`/${empresa}/financeiro/configuracoes`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Ir para Configurações › Contas
        </Link>
      ) : (
        <p className="text-sm text-muted-foreground">Peça a quem gerencia o financeiro.</p>
      )}
    </div>
  );
}
