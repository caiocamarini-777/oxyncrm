"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProduct, setProductActive, updateProduct } from "@/lib/products/actions";
import { PRODUCT_KIND_LABELS, PRODUCT_KINDS } from "@/lib/products/schema";
import { formatMoney } from "@/lib/records/format";

export type ProductRow = {
  id: string;
  name: string;
  kind: (typeof PRODUCT_KINDS)[number];
  defaultPrice: number;
  active: boolean;
};

const SELECT_CLASS = "h-9 rounded-md border border-input bg-background px-3 text-sm";

function priceText(v: number): string {
  return v.toFixed(2).replace(".", ",");
}

export function ProductsManager({ companyId, products }: { companyId: string; products: ProductRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>("setup");
  const [price, setPrice] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  function create(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = await createProduct(companyId, { name, kind: kind as ProductRow["kind"], defaultPrice: price });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? { name: result.error });
        return;
      }
      setName("");
      setPrice("");
      router.refresh();
    });
  }

  function toggleActive(p: ProductRow) {
    setError(null);
    startTransition(async () => {
      const result = await setProductActive(p.id, !p.active);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded-md border p-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-name">Novo produto</Label>
          <Input id="product-name" value={name} aria-invalid={Boolean(errors.name)} onChange={(e) => setName(e.target.value)} className="w-64" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-kind">Tipo</Label>
          <select id="product-kind" value={kind} onChange={(e) => setKind(e.target.value)} className={SELECT_CLASS}>
            {PRODUCT_KINDS.map((k) => (
              <option key={k} value={k}>
                {PRODUCT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-price">Preço padrão</Label>
          <Input id="product-price" inputMode="decimal" placeholder="0,00" value={price} aria-invalid={Boolean(errors.defaultPrice)} onChange={(e) => setPrice(e.target.value)} className="w-36" />
        </div>
        <Button type="submit" disabled={pending}>
          Adicionar produto
        </Button>
        {Object.values(errors).map((m) => (
          <p key={m} role="alert" className="basis-full text-sm text-destructive">
            {m}
          </p>
        ))}
      </form>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {products.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum produto cadastrado.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Nome</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Preço padrão</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {products.map((p) =>
                editingId === p.id ? (
                  <ProductEditRow key={p.id} product={p} onDone={() => setEditingId(null)} />
                ) : (
                  <tr key={p.id} data-testid="product-row" data-active={p.active}>
                    <td className={"px-3 py-2 " + (p.active ? "font-medium" : "text-muted-foreground")}>{p.name}</td>
                    <td className="px-3 py-2">{PRODUCT_KIND_LABELS[p.kind]}</td>
                    <td className="px-3 py-2">{formatMoney(p.defaultPrice)}</td>
                    <td className="px-3 py-2">{p.active ? "Ativo" : <Badge variant="outline">Inativo</Badge>}</td>
                    <td className="flex justify-end gap-1 px-3 py-2">
                      <Button variant="outline" size="sm" aria-label={`Editar ${p.name}`} onClick={() => setEditingId(p.id)}>
                        Editar
                      </Button>
                      <Button variant="outline" size="sm" disabled={pending} aria-label={`${p.active ? "Desativar" : "Ativar"} ${p.name}`} onClick={() => toggleActive(p)}>
                        {p.active ? "Desativar" : "Ativar"}
                      </Button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProductEditRow({ product, onDone }: { product: ProductRow; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(product.name);
  const [kind, setKind] = useState<string>(product.kind);
  const [price, setPrice] = useState(priceText(product.defaultPrice));
  const [errors, setErrors] = useState<Record<string, string>>({});

  function save() {
    setErrors({});
    startTransition(async () => {
      const result = await updateProduct(product.id, { name, kind: kind as ProductRow["kind"], defaultPrice: price });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? { name: result.error });
        return;
      }
      onDone();
      router.refresh();
    });
  }

  return (
    <tr data-testid="product-row-editing">
      <td className="px-3 py-2">
        <Input aria-label={`Nome de ${product.name}`} value={name} onChange={(e) => setName(e.target.value)} />
      </td>
      <td className="px-3 py-2">
        <select aria-label={`Tipo de ${product.name}`} value={kind} onChange={(e) => setKind(e.target.value)} className={SELECT_CLASS}>
          {PRODUCT_KINDS.map((k) => (
            <option key={k} value={k}>
              {PRODUCT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <Input aria-label={`Preço de ${product.name}`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
      </td>
      <td className="px-3 py-2" colSpan={2}>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={pending} onClick={save}>
            Salvar
          </Button>
          <Button size="sm" variant="outline" onClick={onDone}>
            Cancelar
          </Button>
        </div>
        {Object.values(errors).map((m) => (
          <p key={m} role="alert" className="mt-1 text-sm text-destructive">
            {m}
          </p>
        ))}
      </td>
    </tr>
  );
}
