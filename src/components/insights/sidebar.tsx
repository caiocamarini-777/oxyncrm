"use client";

import { ChevronDown, ChevronRight, LayoutDashboard, Plus, Search, Target } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { SidebarData, SidebarItem } from "@/lib/insights/queries";
import { cn } from "@/lib/utils";
import { EntityIcon, iconFor } from "./entity-icon";
import { NewDashboardDialog, NewReportDialog } from "./create-dialogs";

type Props = {
  empresa: string;
  data: SidebarData;
  companies: { id: string; name: string }[];
  canCreate: boolean;
};

function Group({ title, items, render }: { title: string; items: SidebarItem[]; render: (i: SidebarItem) => React.ReactNode }) {
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        {title}
      </button>
      {open ? <ul className="space-y-0.5">{items.map(render)}</ul> : null}
    </div>
  );
}

function Section({ title, icon, count, children }: { title: string; icon: React.ReactNode; count?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="space-y-1">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide">
        {icon}
        {title}
        {count ? <span className="rounded bg-muted px-1 text-[10px] font-normal">{count}</span> : null}
        {open ? <ChevronDown className="ml-auto size-3.5" /> : <ChevronRight className="ml-auto size-3.5" />}
      </button>
      {open ? children : null}
    </section>
  );
}

/** Lateral do Insights: Criar, busca, Painéis, Metas e Relatórios (compartilhados comigo e meus). */
export function InsightsSidebar({ empresa, data, companies, canCreate }: Props) {
  const path = usePathname();
  const [q, setQ] = useState("");
  const [newReport, setNewReport] = useState(false);
  const [newDash, setNewDash] = useState(false);
  const multi = companies.length > 1;
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? "";
  const match = (i: SidebarItem) => i.name.toLowerCase().includes(q.toLowerCase());
  const dashboards = data.dashboards.filter(match);
  const reports = data.reports.filter(match);

  const item = (href: string, icon: React.ReactNode) => (i: SidebarItem) => {
    const active = path === href.replace("{id}", i.id);
    return (
      <li key={i.id}>
        <Link
          href={href.replace("{id}", i.id)}
          title={i.name}
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent",
            active ? "bg-accent font-medium text-primary" : "text-foreground/80",
          )}
        >
          {icon ?? <EntityIcon icon={iconFor(i.kind)} className="size-4 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1 truncate">{i.name}</span>
          {multi ? <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{companyName(i.companyId).slice(0, 8)}</span> : null}
        </Link>
      </li>
    );
  };
  const dashItem = item(`/${empresa}/relatorios/paineis/{id}`, <LayoutDashboard className="size-4 shrink-0 text-muted-foreground" />);
  const repItem = item(`/${empresa}/relatorios/r/{id}`, null);

  return (
    <aside className="flex w-full flex-col gap-4 lg:w-60 lg:shrink-0" aria-label="Insights">
      <div className="flex items-center gap-2">
        {canCreate ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="flex-1">
                <Plus className="size-4" /> Criar <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuItem onSelect={() => setNewReport(true)}>Relatório</DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/${empresa}/relatorios/metas`}>Meta</Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setNewDash(true)}>Painel</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar no Insights" className="pl-8" aria-label="Buscar no Insights" />
      </div>
      <nav className="flex max-h-[calc(100vh-14rem)] flex-col gap-4 overflow-y-auto pr-1">
        <Section title="Painéis" icon={<LayoutDashboard className="size-3.5" />}>
          <Group title="Compartilhado comigo" items={dashboards.filter((d) => !d.mine)} render={dashItem} />
          <Group title="Meus painéis" items={dashboards.filter((d) => d.mine)} render={dashItem} />
          {dashboards.length === 0 ? <p className="px-2 text-xs text-muted-foreground">Nenhum painel.</p> : null}
        </Section>
        <Section title="Metas" icon={<Target className="size-3.5" />}>
          <Link
            href={`/${empresa}/relatorios/metas`}
            className={cn("block rounded-md px-2 py-1 text-sm hover:bg-accent", path.endsWith("/metas") && "bg-accent font-medium text-primary")}
          >
            Ver metas
          </Link>
        </Section>
        <Section title="Relatórios" icon={<EntityIcon icon="deal" className="size-3.5" />} count={String(data.reports.length)}>
          <Group title="Compartilhado comigo" items={reports.filter((r) => !r.mine)} render={repItem} />
          <Group title="Meus relatórios" items={reports.filter((r) => r.mine)} render={repItem} />
          {reports.length === 0 ? <p className="px-2 text-xs text-muted-foreground">Nenhum relatório.</p> : null}
        </Section>
      </nav>
      {newReport ? <NewReportDialog empresa={empresa} companies={companies} open={newReport} onOpenChange={setNewReport} /> : null}
      {newDash ? <NewDashboardDialog empresa={empresa} companies={companies} open={newDash} onOpenChange={setNewDash} /> : null}
    </aside>
  );
}
