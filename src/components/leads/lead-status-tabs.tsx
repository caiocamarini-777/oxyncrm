"use client";

import { StatusTabs } from "@/components/records/status-tabs";

const TABS = [
  { status: "open", label: "Abertos" },
  { status: "disqualified", label: "Desqualificados" },
  { status: "archived", label: "Arquivados" },
];

/** Abas por status dos leads: `open` por padrão. */
export function LeadStatusTabs() {
  return <StatusTabs tabs={TABS} ariaLabel="Status dos leads" />;
}
