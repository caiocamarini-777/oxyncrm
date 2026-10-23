# Pendências da fase 6 (relatórios, dashboards e metas)

Registro do que foi decidido, adiado e do que precisa de ação antes de seguir. A fase 6 entrega o construtor de relatórios, os relatórios prontos, dashboards com grade arrastável, compartilhamento com usuários e por link público, e metas por empresa, usuário e equipe.

## Base adiada

- A base "e-mails" do construtor de relatórios fica para depois da fase 5 (e-mail), que ainda não existe. A especificação a lista; hoje o construtor oferece leads, negócios, atividades, receita e histórico de etapas.

## Verificação manual pendente

- Os gráficos de linha, pizza e funil ainda precisam de uma conferência visual manual (cores, rótulos, tooltip, modo escuro e tela estreita). Os testes automatizados validam os dados e a tabela alternativa, não a aparência.

## Decisões que você pode querer rever

- O preset de progresso de metas (`goal_progress`) só entrou na Task 4, depois de a função `goal_progress()` existir; o despachante de presets da Task 3 não o conhecia. Foi só ordem de implementação, sem efeito de produto.
- A fase foi executada sem aprovação intermediária do plano, a pedido de quem avisou que queria ser notificado só no fim. Se o escopo for diferente do desejado, há retrabalho.
- A base "e-mails" ficou de fora (ver acima), apesar de constar na especificação.
- As metas são geridas só pelo admin geral (a especificação não diz quem cria metas). Se outros papéis devem criar, falta uma chave de permissão nova.
- O dashboard usa dnd-kit com tamanhos em passos (largura de 1 a 4 colunas, altura de 1 a 3 linhas) em vez de uma biblioteca de grade livre. Evita o risco de compatibilidade da `react-grid-layout` com React 19, ao custo de um redimensionamento menos fino.
- Compartilhar com usuários exige que o destinatário divida uma empresa com o dono (ou seja admin geral). A especificação diz "qualquer usuário", mas isso vazaria o alcance do criador entre empresas; o link público cobre quem está de fora.
- Dashboards e relatórios só se criam com `owner_id = auth.uid()`, mesmo pelo admin geral, porque o dono define o alcance da execução. O admin geral não cria em nome de outro.
- O dono pode revogar compartilhamentos e links sem ter `share_dashboards`: revogar só reduz a exposição.
- Funil e influência por canal aplicam o escopo de leads e negócios às contagens de oportunidade e ganho, então quem enxerga só os próprios registros vê números menores que os baseados em atividades.
- Reuniões realizadas criadas no negócio depois da conversão são creditadas ao lead de origem (via `deals.lead_id`), não só as migradas.
- Toda saída de `run_report` ganha o campo `truncated`, e a interface avisa o corte em 500 linhas.
- O crédito por canal é por canal, então as linhas do funil não somam (há nota na tela).
- Os filtros padrão do dashboard (`default_filters`) são padrões de interface, não um teto: quem abre pelo link público pode ampliar até o período do próprio relatório.
- As metas são visíveis a qualquer membro da empresa (a página fica sob Relatórios, que exige `view_reports`), e os valores são limitados pela visibilidade de quem consulta.
- Um destinatário de dashboard compartilhado abre a lista e a página sem `view_reports`: a especificação (5.3) diz que o compartilhado é visível ao destinatário e `view_reports` governa a construção de relatórios.
- Ausente ou nulo em um filtro significa sem filtro; lista vazia significa nada. Interseções vazias e padrões inválidos enviam lista vazia, igual ao banco e sem nunca ampliar. Padrões mal configurados mostram widgets vazios.
- Widgets de relatórios salvos respeitam a empresa em que o relatório foi salvo (`run_widget_as` intersecta com `reports.company_id`); em "Todas as empresas" um relatório de uma empresa só continua nela.
- O dono que perdeu `view_reports` continua editando o layout do próprio dashboard (só "Adicionar widget" some).
- O preset foi renomeado para "Funil de reuniões por canal", o nome da especificação.

## Melhorias adiadas

### Motor de relatórios (banco)

- Filtros de período e data envolvem a coluna em conversão de fuso, o que impede o uso de índice.
- Os rótulos são calculados por linha antes do agrupamento.
- Datas nulas formam um balde "mês nulo".
- Lacunas de teste: escopo próprio em negócios e histórico de etapas, `avg_days` em negócios, listas de empresas vazias, agrupar por mês em campo de data.
- As linhas do relatório não têm ids, então não há drill-down.
- O trailer de commit da Task 2 saiu com outro modelo.
- Influência na conversão: a subconsulta correlacionada cresce com eventos vezes atividades.
- O preset de progresso de metas chama `goal_progress` uma vez por meta (N varreduras).
- Progresso de metas: a ordenação do CTE (por 2, 1) agora ordena pela métrica antes do limite de 501; só importa com mais de 501 metas.

### Compartilhamento e links

- No teste 24, o caso "link sem share_dashboards" passa pelo grant e não pela configuração (redundante).
- Não existe RPC para mudar a validade de um link; para trocar, recrie o link.
- A página pública devolve só `w.title`: widgets de relatório com título vazio aparecem como "Sem título" (os novos já herdam o nome do relatório).
- O token aparece nos logs de acesso do host, o que é inerente a tokens em URL.

### Biblioteca e app

- Em "Todas as empresas", `has_report_setting` é chamado N vezes (N+1).
- A posição de `addWidget` tem corrida (cosmético).
- `revalidatePath("/", "layout")` é amplo demais.
- `reportCompanySlugs` faz N RPCs a cada navegação, no layout do app.
- Rótulos de etapa não marcam funil arquivado.
- A página do relatório confere se a empresa está no escopo, mas não `view_reports` por empresa.

### Dashboards

- Todo salvamento de layout revalida o layout inteiro, então todos os widgets consultam de novo.
- A alça de redimensionar fica escondida no celular.
- Se o `onDone` da fila de salvamento lançar erro, a fila trava.
- O teste 29 tem ajudantes sem uso.
- Em "Todas as empresas", a empresa da URL substitui a lista padrão de empresas (o banco continua limitando).
- Um período padrão inválido é descartado em silêncio.

## Pendências carregadas das fases anteriores

- Validação de aplicação do zero: as migrações das fases 3 e 4 foram editadas no lugar durante o desenvolvimento e reaplicadas à mão. Falta resetar o banco de desenvolvimento e aplicar `supabase/migrations/` inteiro (incluindo as da fase 6, `20261025000001` a `20261025000010`) para confirmar que não há deriva. Exige o reset do banco de dev, ação do dono do projeto.
- Merge dos PRs empilhados (fases 2, 3, 4 e 6), em ordem, antes de qualquer deploy.
- Preparar a produção: projeto Supabase de produção com as migrações aplicadas, usuário admin geral e variáveis de ambiente da Vercel.
- Definir `CRON_SECRET` e `NEXT_PUBLIC_SITE_URL` (domínio de produção) nas variáveis da Vercel. A segunda também é obrigatória para os links públicos de dashboards. Em `.env.local`, sem `CRON_SECRET` o teste E2E do e-mail dos lembretes (`e2e/reminders.spec.ts`) e o `pnpm reminders:send` ficam de fora; é o único teste ignorado.
- Plano da Vercel: o cron `*/5 * * * *` dos lembretes exige o plano Pro. No Hobby, agendar `GET /api/cron/lembretes` via pg_cron + pg_net com o header `Authorization: Bearer <CRON_SECRET>`.
- Conferir em produção que a rotina `generate_activity_reminders` (pg_cron, a cada minuto) está agendada depois da aplicação das migrações.
- Demais melhorias adiadas da fase 4 continuam valendo: veja `docs/superpowers/followups/2026-10-24-fase-4-pendencias.md`.
