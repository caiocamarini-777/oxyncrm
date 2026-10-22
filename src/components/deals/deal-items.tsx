"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addDealItem, removeDealItem, updateDealItem } from "@/lib/deals/actions";
import type { DealDetail, DealItemRow, ProductOption } from "@/lib/deals/queries";
import { contractDatesNeeded } from "@/lib/deals/schema";
import { formatMoney } from "@/lib/records/format";
import { PRODUCT_KIND_LABELS } from "@/lib/products/schema";

const selectClass = "h-8 w-full rounded-md border border-input bg-background px-2 text-sm";
const num = (v: number) => String(v).replace(".", ",");

type Draft = { productId: string; quantity: string; unitPrice: string; discount: string; mrrStart: string; contractMonths: string; setupFirstDue: string };

const EMPTY: Draft = { productId: "", quantity: "1", unitPrice: "", discount: "", mrrStart: "", contractMonths: "", setupFirstDue: "" };

/** Id do cartão Produtos (o diálogo de obrigatórios leva o foco até ele). */
export const DEAL_PRODUCTS_ID = "produtos";

/** Produtos do negócio: tabela de itens, totais Setup e MRR, e inclusão/edição/remoção. */
export function DealItems({
  deal,
  products,
  canEdit,
}: {
  deal: Pick<DealDetail, "id" | "items" | "mrrStart" | "contractMonths" | "setupFirstDue">;
  /** Somente produtos ativos da empresa. */
  products: ProductOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<{ item: DealItemRow | null } | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const setup = deal.items.filter((i) => i.kind === "setup").reduce((s, i) => s + Math.round(i.total * 100), 0) / 100;
  const mrr = deal.items.filter((i) => i.kind === "recurring").reduce((s, i) => s + Math.round(i.total * 100), 0) / 100;

  const editing = dialog?.item ?? null;
  const product = products.find((p) => p.id === draft.productId);
  const needed = !editing && product ? contractDatesNeeded(deal, product.kind) : null;

  function open(item: DealItemRow | null) {
    setErrors({});
    setFormError(null);
    setDraft(
      item
        ? { ...EMPTY, productId: item.productId, quantity: num(item.quantity), unitPrice: num(item.unitPrice), discount: item.discount ? num(item.discount) : "" }
        : EMPTY,
    );
    setDialog({ item });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const values = { quantity: draft.quantity, unitPrice: draft.unitPrice, discount: draft.discount };
      const res = editing
        ? await updateDealItem(editing.id, values)
        : await addDealItem(
            deal.id,
            { productId: draft.productId, ...values },
            needed === "mrr"
              ? { mrrStart: draft.mrrStart || null, contractMonths: draft.contractMonths ? Number(draft.contractMonths) : null }
              : needed === "setup"
                ? { setupFirstDue: draft.setupFirstDue || null }
                : undefined,
          );
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
        return;
      }
      toast.success(editing ? "Produto atualizado." : "Produto adicionado.");
      setDialog(null);
      router.refresh();
    });
  }

  function remove(item: DealItemRow) {
    startTransition(async () => {
      const res = await removeDealItem(item.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
      let undoing = false;
      toast.success("Produto removido.", {
        action: {
          label: "Desfazer",
          onClick: async () => {
            if (undoing) return;
            undoing = true;
            const back = await addDealItem(deal.id, {
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discount: item.discount,
            });
            if (back.ok) router.refresh();
            else {
              undoing = false;
              toast.error(back.error);
            }
          },
        },
      });
    });
  }

  return (
    <Card
      id={DEAL_PRODUCTS_ID}
      role="region"
      tabIndex={-1}
      aria-labelledby={`${DEAL_PRODUCTS_ID}-title`}
      className="scroll-mt-4 outline-none focus:ring-2 focus:ring-primary"
    >
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle id={`${DEAL_PRODUCTS_ID}-title`} className="font-heading text-xs uppercase tracking-wide text-muted-foreground">
          Produtos
        </CardTitle>
        {canEdit ? (
          <Button type="button" size="sm" variant="outline" onClick={() => open(null)}>
            <Plus /> Adicionar produto
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {deal.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum produto neste negócio.</p>
        ) : (
          <div className="overflow-x-auto">
            <table data-testid="items-table" className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1 pr-2 font-medium">Produto</th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">Qtd.</th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">Preço</th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">Desc.</th>
                  <th scope="col" className="py-1 text-right font-medium">Total</th>
                  {canEdit ? <th scope="col" className="w-16"><span className="sr-only">Ações</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {deal.items.map((i) => (
                  <tr key={i.id} data-testid="item-row" className="border-t align-top">
                    <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                      <span className="font-medium">{i.productName}</span>
                      {!i.productActive ? <span className="text-muted-foreground"> (inativo)</span> : null}
                      <span className="block text-muted-foreground">{PRODUCT_KIND_LABELS[i.kind]}</span>
                    </th>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{num(i.quantity)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{formatMoney(i.unitPrice)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{formatMoney(i.discount)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(i.total)}</td>
                    {canEdit ? (
                      <td className="py-1 text-right">
                        <div className="flex justify-end">
                          <Button type="button" size="icon-sm" variant="ghost" aria-label={`Editar ${i.productName}`} onClick={() => open(i)}>
                            <Pencil />
                          </Button>
                          <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remover ${i.productName}`} disabled={pending} onClick={() => remove(i)}>
                            <Trash2 />
                          </Button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t pt-2 text-sm">
          <dt className="text-muted-foreground">Setup</dt>
          <dd data-testid="items-setup" className="text-right tabular-nums">{formatMoney(setup)}</dd>
          <dt className="text-muted-foreground">MRR</dt>
          <dd data-testid="items-mrr" className="text-right tabular-nums">{formatMoney(mrr)}</dd>
        </dl>
      </CardContent>

      <Dialog open={dialog !== null} onOpenChange={(o) => (o ? null : setDialog(null))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar produto" : "Adicionar produto"}</DialogTitle>
            <DialogDescription>{editing ? editing.productName : "Escolha o produto, a quantidade e o preço."}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} noValidate className="flex flex-col gap-3">
            <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3">
              {editing ? null : (
                <Field id="item-product" label="Produto" error={errors.productId}>
                  <select
                    id="item-product"
                    value={draft.productId}
                    className={selectClass}
                    onChange={(e) => {
                      const p = products.find((x) => x.id === e.target.value);
                      setDraft((d) => ({ ...d, productId: e.target.value, unitPrice: p ? num(p.defaultPrice) : d.unitPrice }));
                    }}
                  >
                    <option value="">Escolha um produto</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({PRODUCT_KIND_LABELS[p.kind]})
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <div className="grid grid-cols-3 gap-3">
                <Field id="item-quantity" label="Quantidade" error={errors.quantity}>
                  <Input id="item-quantity" inputMode="decimal" value={draft.quantity} onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))} />
                </Field>
                <Field id="item-price" label="Preço unitário (R$)" error={errors.unitPrice}>
                  <Input id="item-price" inputMode="decimal" placeholder="0,00" value={draft.unitPrice} onChange={(e) => setDraft((d) => ({ ...d, unitPrice: e.target.value }))} />
                </Field>
                <Field id="item-discount" label="Desconto (R$)" error={errors.discount}>
                  <Input id="item-discount" inputMode="decimal" placeholder="0,00" value={draft.discount} onChange={(e) => setDraft((d) => ({ ...d, discount: e.target.value }))} />
                </Field>
              </div>
              {needed === "mrr" ? (
                <div className="grid grid-cols-2 gap-3 rounded-lg border p-3">
                  <p className="col-span-2 text-xs text-muted-foreground">Este é o primeiro item recorrente: informe o início e a duração do contrato.</p>
                  <Field id="item-mrr-start" label="Início do MRR" error={errors.mrrStart}>
                    <Input id="item-mrr-start" type="month" value={draft.mrrStart} onChange={(e) => setDraft((d) => ({ ...d, mrrStart: e.target.value }))} />
                  </Field>
                  <Field id="item-months" label="Duração (meses)" error={errors.contractMonths}>
                    <Input id="item-months" type="number" min={1} max={120} value={draft.contractMonths} onChange={(e) => setDraft((d) => ({ ...d, contractMonths: e.target.value }))} />
                  </Field>
                </div>
              ) : null}
              {needed === "setup" ? (
                <div className="rounded-lg border p-3">
                  <p className="mb-2 text-xs text-muted-foreground">Este é o primeiro item de setup: informe o mês da primeira parcela.</p>
                  <Field id="item-first-due" label="Mês da 1ª parcela" error={errors.setupFirstDue}>
                    <Input id="item-first-due" type="month" value={draft.setupFirstDue} onChange={(e) => setDraft((d) => ({ ...d, setupFirstDue: e.target.value }))} />
                  </Field>
                </div>
              ) : null}
            </fieldset>
            {formError ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Salvando..." : editing ? "Salvar" : "Adicionar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
