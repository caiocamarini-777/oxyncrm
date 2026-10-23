"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { serializeListQuery } from "@/lib/records/query";
import { PAGE_SIZE, type ListQuery, type RecordEntity } from "@/lib/records/types";

const features = tableFeatures({});

export type RecordColumn<T> = {
  id: string;
  header: string;
  /** Valor aceito em `sort`; sem ele a coluna não ordena. */
  sortKey?: string;
  cell: (row: T) => ReactNode;
  defaultHidden?: boolean;
  /** Exibida só na visão "Todas" (ver `companyColumn`). */
  companyOnly?: boolean;
};

export type TableEntity = RecordEntity | "activities";

export const storageKey = (entity: TableEntity) => `oxyn:columns:${entity}`;

/** Ids ocultos salvos; qualquer falha de leitura cai no padrão. */
export function readHidden(entity: TableEntity, fallback: string[]): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey(entity));
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === "string") ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  total,
  query,
  entity,
  companyColumn = false,
  rowHref,
  createHref,
  createLabel = "Criar",
}: {
  columns: RecordColumn<T>[];
  rows: T[];
  total: number;
  query: ListQuery;
  entity: TableEntity;
  /** true na visão "Todas": mostra a coluna de empresa. */
  companyColumn?: boolean;
  /** Destino do detalhe de cada linha (use recordHref com o slug da empresa do registro). */
  rowHref: (row: T) => string | null;
  createHref?: string;
  createLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const available = useMemo(
    () => columns.filter((c) => !c.companyOnly || companyColumn),
    [columns, companyColumn],
  );
  const defaults = useMemo(() => columns.filter((c) => c.defaultHidden).map((c) => c.id), [columns]);
  const [hidden, setHidden] = useState<string[]>(defaults);

  useEffect(() => {
    // leitura do localStorage só no cliente, depois da hidratação
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHidden(readHidden(entity, defaults));
  }, [entity, defaults]);

  function toggle(id: string, visible: boolean) {
    const next = visible ? hidden.filter((h) => h !== id) : [...hidden, id];
    setHidden(next);
    try {
      window.localStorage.setItem(storageKey(entity), JSON.stringify(next));
    } catch {
      // sem armazenamento: vale só nesta sessão
    }
  }

  const visible = useMemo(() => available.filter((c) => !hidden.includes(c.id)), [available, hidden]);
  const helper = useMemo(() => createColumnHelper<typeof features, T>(), []);
  const defs = useMemo(
    () =>
      helper.columns(
        visible.map((c) =>
          helper.display({ id: c.id, header: c.header, cell: ({ row }) => c.cell(row.original) }),
        ),
      ),
    [helper, visible],
  );
  const table = useTable({ features, columns: defs, data: rows });

  function sortBy(key: string) {
    const dir = query.sort === key && query.dir === "asc" ? "desc" : "asc";
    const qs = serializeListQuery({ ...query, sort: key, dir, page: 1 });
    // preserva parâmetros que não são da lista (ex.: view)
    const params = new URLSearchParams(qs);
    for (const [k, v] of searchParams.entries()) {
      if (!["q", "page", "sort", "dir", "owner", "label", "status", "source", "createdFrom", "createdTo"].includes(k)) {
        params.append(k, v);
      }
    }
    const s = params.toString();
    router.push(s ? `${pathname}?${s}` : pathname);
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
        <p className="text-sm text-muted-foreground">Nenhum registro encontrado.</p>
        {createHref ? (
          <Button asChild>
            <Link href={createHref}>{createLabel}</Link>
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {total} {total === 1 ? "registro" : "registros"}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns3 /> Colunas
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Colunas visíveis</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {available.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.id}
                checked={!hidden.includes(c.id)}
                onCheckedChange={(v) => toggle(c.id, v === true)}
                onSelect={(e) => e.preventDefault()}
              >
                {c.header}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const col = visible.find((c) => c.id === header.column.id)!;
                  const active = col.sortKey !== undefined && query.sort === col.sortKey;
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={active ? (query.dir === "asc" ? "ascending" : "descending") : undefined}
                    >
                      {col.sortKey ? (
                        <button
                          type="button"
                          onClick={() => sortBy(col.sortKey!)}
                          className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                        >
                          {col.header}
                          {active ? (
                            query.dir === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />
                          ) : (
                            <ArrowUpDown className="size-3.5 opacity-40" />
                          )}
                        </button>
                      ) : (
                        col.header
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className={rowHref(row.original) ? "cursor-pointer" : undefined}
                tabIndex={0}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a, button, input, [role=checkbox]")) return;
                  const href = rowHref(row.original);
                  if (href) router.push(href);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  if ((e.target as HTMLElement).closest("a, button, input, [role=checkbox]")) return;
                  const href = rowHref(row.original);
                  if (href) router.push(href);
                }}
              >
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <span className="sr-only">Página com até {PAGE_SIZE} registros</span>
    </div>
  );
}
