import type { ReactNode } from "react";

/** Detalhe do registro: dados fixos (360 px) à esquerda; abas e linha do tempo ao centro. */
export function RecordLayout({
  header,
  details,
  main,
}: {
  header: ReactNode;
  details: ReactNode;
  main: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <header>{header}</header>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 lg:w-[360px]">{details}</aside>
        <section className="min-w-0 flex-1">{main}</section>
      </div>
    </div>
  );
}
