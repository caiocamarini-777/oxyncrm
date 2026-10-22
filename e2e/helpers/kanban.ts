import { expect, type Locator, type Page } from "@playwright/test";

/** Região ao vivo do dnd-kit (anúncios "Card ... levantado.", "Sobre a etapa ..."). */
export const liveRegion = (page: Page) => page.locator('[id^="DndLiveRegion"]');

/**
 * Arrasta um card do kanban com o mouse em passos (o sensor de ponteiro só ativa depois de 6 px).
 * Sem pausas fixas: espera o arraste começar (zonas do rodapé paradas na tela) e o anúncio de que
 * o card está sobre o destino antes de soltar.
 */
export async function dragCard(
  page: Page,
  source: Locator,
  target: () => Locator,
  opts: { where?: "center" | "top"; announce?: string | RegExp; during?: () => Promise<void> } = {},
) {
  await source.scrollIntoViewIfNeeded();
  const s = await source.boundingBox();
  if (!s) throw new Error("card sem caixa");
  const sx = s.x + s.width / 2;
  const sy = s.y + s.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 12, sy + 12, { steps: 4 });
  // Arraste ativo: o rodapé de zonas terminou de entrar (opacidade final).
  await expect(page.getByTestId("drop-won").locator("xpath=../..")).toHaveCSS("opacity", "1");
  await target().scrollIntoViewIfNeeded();
  const t = await target().boundingBox();
  if (!t) throw new Error("destino sem caixa");
  const tx = t.x + t.width / 2;
  const ty = opts.where === "top" ? t.y + 6 : t.y + t.height / 2;
  await page.mouse.move(tx, ty, { steps: 20 });
  await page.mouse.move(tx + 1, ty + 1, { steps: 2 });
  await expect(liveRegion(page)).toHaveText(opts.announce ?? /^Sobre a /);
  if (opts.during) await opts.during();
  await page.mouse.up();
}
