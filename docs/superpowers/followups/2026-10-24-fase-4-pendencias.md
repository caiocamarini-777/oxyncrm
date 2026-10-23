# Pendências da fase 4 (atividades)

Registro do que foi decidido, adiado e do que precisa de ação antes de seguir. A fase 4 entrega atividades (tipos, canais e resultados configuráveis), conclusão com resultado obrigatório, agendamento de reunião e próxima atividade (regra por funil e para os leads da empresa), lista e agenda, indicadores no kanban e nos leads, e lembretes no app e por e-mail.

## Melhorias adiadas

- Lixeira: as atividades excluídas não aparecem na página genérica da lixeira (`RECORD_ENTITIES` não foi ampliado). Elas são restauradas pela ação `restoreActivity` e purgadas junto com os registros vinculados ou pelo `purge_trash`.
- Visibilidade: a visibilidade de uma atividade é independente da visibilidade do registro vinculado (quem enxerga a atividade pode não enxergar o lead, a pessoa ou o negócio). É uma decisão de produto a confirmar; hoje a RLS de atividades espelha a de negócios.
- Concorrência: os guards com advisory lock (conclusão, reabertura, regras de último tipo, resultado e canal) não têm um teste de concorrência real; os testes pgTAP rodam em uma única sessão.
- "Nova atividade" em `/atividades` só vincula pessoa ou organização: o `ActivityForm` não tem busca de lead nem de negócio. Para vincular a leads e negócios, criar a atividade pela aba Atividade da ficha.

## Ações manuais

- Cron dos lembretes na Vercel: `*/5 * * * *` exige o plano Pro. No Hobby, agendar `GET /api/cron/lembretes` via pg_cron + pg_net com o header `Authorization: Bearer <CRON_SECRET>`.
- Definir `CRON_SECRET` e `NEXT_PUBLIC_SITE_URL` (domínio de produção, usado nos links do e-mail) nas variáveis da Vercel.
- Adicionar `CRON_SECRET` ao `.env.local`. Sem ele, o teste E2E do envio do e-mail (`e2e/reminders.spec.ts`) e o `pnpm reminders:send` ficam de fora; é o único teste ignorado.
- Conferir em produção que a rotina `generate_activity_reminders` (pg_cron, a cada minuto) está agendada depois da aplicação das migrações.

## Pendências carregadas da fase 3

- Validação de aplicação do zero: as migrações das fases 3 e 4 foram editadas no lugar durante o desenvolvimento e reaplicadas à mão. Falta resetar o banco de desenvolvimento e aplicar `supabase/migrations/` inteiro para confirmar que não há deriva (precisa de reset do banco de dev, ação do dono do projeto).
- Merge dos PRs empilhados (fases 2, 3 e 4), em ordem, antes de qualquer deploy.

## Notas para a fase 6 (relatórios)

Consultas do funil por canal:

- Tentativas = atividades concluídas em leads, por canal (`activities.done`, `channel_id`).
- Reuniões agendadas = atividades concluídas com resultado `books_meeting` (`activity_outcomes.books_meeting`), por canal.
- Reuniões realizadas = reuniões com `meeting_outcome = 'held'`, agrupadas por `origin_channel_id` (o canal da atividade que agendou; `booked_by_activity_id` aponta para ela).
- Oportunidades = leads convertidos com reunião realizada de origem.
- Ganhos = negócios ganhos desses leads.
