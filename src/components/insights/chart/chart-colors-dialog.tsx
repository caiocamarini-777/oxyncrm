"use client";

import { Check, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Series } from "@/lib/insights/chart-shape";
import { PALETTE_ROWS } from "@/lib/insights/palette";

export type ColorsSave = {
  /** cor por chave de valor, gravada no relatório */
  report: Record<string, string>;
  /** valores marcados como padrão da empresa */
  company: Record<string, string>;
  saved: string[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  segments: Series[];
  saved: string[];
  canSetCompany: boolean;
  onSave: (s: ColorsSave) => void | Promise<void>;
};

function Swatch({ color, selected, onClick, label }: { color: string; selected: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label ?? color}
      aria-pressed={selected}
      className="flex size-5 items-center justify-center rounded-sm ring-offset-1 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
      style={{ background: color }}
    >
      {selected ? <Check className="size-3.5 text-white mix-blend-difference" aria-hidden /> : null}
    </button>
  );
}

/** "Personalizar cores": cor de cada segmento, a paleta do sistema, as cores salvas e a cor personalizada. */
export function ChartColorsDialog({ open, onOpenChange, segments, saved, canSetCompany, onSave }: Props) {
  const [active, setActive] = useState(0);
  const [colors, setColors] = useState<Record<string, string>>(() => Object.fromEntries(segments.map((s) => [s.key, s.color])));
  const [company, setCompany] = useState<Record<string, boolean>>({});
  const [mine, setMine] = useState<string[]>(saved);
  const [busy, setBusy] = useState(false);
  const seg = segments[active];
  const current = seg ? (colors[seg.key] ?? seg.color) : "#000000";
  const pick = (c: string) => seg && setColors((x) => ({ ...x, [seg.key]: c.toLowerCase() }));

  async function save() {
    setBusy(true);
    const changed = Object.fromEntries(segments.filter((s) => colors[s.key] && colors[s.key] !== s.color).map((s) => [s.key, colors[s.key]!]));
    const companyColors = Object.fromEntries(segments.filter((s) => company[s.key]).map((s) => [s.key, colors[s.key] ?? s.color]));
    await onSave({ report: changed, company: companyColors, saved: mine });
    setBusy(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Personalizar cores</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Escolher segmento</p>
            <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
              {segments.map((s, i) => (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => setActive(i)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${i === active ? "bg-accent font-medium" : "hover:bg-accent/50"}`}
                  >
                    <span className="size-4 shrink-0 rounded-sm" style={{ background: colors[s.key] ?? s.color }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Escolher cor</p>
            <div>
              <p className="mb-1.5 text-sm font-medium">Cores do sistema</p>
              <div className="grid grid-cols-14 gap-1" style={{ gridTemplateColumns: "repeat(14, 1.25rem)" }}>
                {PALETTE_ROWS.flat().map((c) => (
                  <Swatch key={c} color={c} selected={current === c} onClick={() => pick(c)} />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium">Minhas cores salvas</p>
              <div className="flex flex-wrap items-center gap-1">
                {mine.map((c) => (
                  <Swatch key={c} color={c} selected={current === c} onClick={() => pick(c)} />
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-xs"
                  disabled={mine.includes(current) || mine.length >= 28}
                  onClick={() => setMine((m) => [...m, current])}
                >
                  <Plus className="size-3.5" aria-hidden /> Adicionar novo
                </Button>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="cor-personalizada">
                Cor personalizada
              </label>
              <input
                id="cor-personalizada"
                type="color"
                value={current}
                onChange={(e) => pick(e.target.value)}
                className="h-8 w-14 cursor-pointer rounded border bg-transparent"
              />
            </div>
            {canSetCompany && seg ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!company[seg.key]}
                  onChange={(e) => setCompany((x) => ({ ...x, [seg.key]: e.target.checked }))}
                />
                Usar esta cor como padrão da empresa para “{seg.label}”
              </label>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button onClick={save} disabled={busy}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
