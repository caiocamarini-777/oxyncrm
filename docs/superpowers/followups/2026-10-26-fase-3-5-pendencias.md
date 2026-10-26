# Pendências da fase 3.5 (importação do Pipedrive)

Registro do que foi decidido, adiado e do que precisa de ação antes da importação real. A fase 3.5 entrega o assistente de importação (admin geral), o motor por etapas, o script `pnpm import:pipedrive` e as funções de banco que gravam dados históricos sem disparar efeitos falsos.

## Decisões que você pode querer rever

- A fase foi executada sem aprovação intermediária do plano, a pedido de quem avisou que queria ser notificado só no fim. Se o escopo for diferente do desejado, há retrabalho.
- Contatos ligados a várias empresas são duplicados por empresa, por isolamento entre empresas. Custo se estiver errado: duplicidade entre empresas, por desenho.
- A empresa do lead vem da etiqueta de empresa; a do negócio, do mapeamento de funil; órfãos vão para uma empresa padrão escolhida no assistente. Custo se estiver errado: refazer o mapeamento e reimportar.
- Reimportar nunca sobrescreve registros editados no CRM depois da importação (checagem de `updated_at`). Custo: edições feitas no Pipedrive depois da migração são ignoradas nesses registros.
- Contrato inválido (MRR sem meses) entra com `mrr = 0` e aviso, em vez de descartar o negócio. Custo: o MRR precisa ser preenchido à mão.
- Atividade concluída importada sem resultado recebe o resultado "Importado", mantendo a regra de conclusão. Custo: um resultado a mais na lista.
- O token vem só do ambiente e nunca é gravado no banco. Custo: o assistente não troca o token pela interface.
- A trava do job é uma coluna de concessão (RPC `import_claim`), não advisory lock, que não sobrevive ao PostgREST com pool. Custo: uma fatia que cai bloqueia o job por até 120 s.
- `users_check` é estrito por usuário e empresa do funil, incluindo donos de leads. A troca de dono (dono de reserva com aviso agregado) vale só para cópias de contatos e atividades. Custo: o admin precisa acertar vínculos antes de importar, e alguns contatos e atividades ficam com o dono de reserva.
- A pessoa entra nas empresas dos próprios negócios e leads mais as da organização dela; a organização herda as empresas das pessoas dela (o índice lê as pessoas para isso). Só sem nenhuma das duas a pessoa vai para a empresa padrão. Custo: mais cópias de contatos entre empresas.
- Produtos vão só para a empresa padrão, e os produtos dos negócios (deal products) não são importados. A conta real tem 0 produtos hoje. Custo: se a conta passar a usar produtos, falta distribuí-los por empresa e importar os itens dos negócios.

## Melhorias adiadas

### Banco (funções de importação)

- `import_jobs.created_by` pode ser definido por um admin geral na criação.
- `import_outcome` tem corrida em conflito ao criar o resultado "Importado".
- A atualização de anotações reescreve `created_by` para o autor de reserva.

### Mapeamento (Pipedrive)

- Campo de texto com valor "1,2" não é expandido pelas opções.
- Vírgula dentro de rótulo de multisseleção separa o rótulo em dois.
- O teste de aborto simula `DOMException`.

### Motor

- Os contadores ficam aproximados quando uma fatia é refeita depois de uma queda.
- `loadMeta` repete a cada fatia.
- O cache é reescrito a cada `saveCursor`.
- Aviso de troca de dono pode duplicar se o cursor for recusado logo após o registro do aviso (sem transação entre as duas gravações; cosmético).

### Assistente

- `store.members` seleciona todos os perfis.
- Cada abertura de um job em rascunho faz 7 chamadas ao Pipedrive.

## Como rodar a importação real

1. Dê a cada usuário do Pipedrive (7, sendo 1 inativo) uma conta no Oxyn, com vínculo nas empresas certas: dono de negócio ou de lead precisa ser membro da empresa do funil ou da etiqueta.
2. Confirme `PIPEDRIVE_API_TOKEN` em `.env.local` (ou na Vercel). Nunca grave o token em arquivo versionado.
3. Em `/configuracoes/importacao`, crie o job, preencha funis, usuários, etiquetas, padrões e campos personalizados.
4. Rode **Simular**. Se o resultado for parcial (teto de 45 s), rode `pnpm import:pipedrive <jobId> --dry-run`.
5. Corrija o que a simulação apontar e inicie a importação pelo assistente (que valida os mapeamentos). Depois de iniciada, ela pode continuar pela tela ou por `pnpm import:pipedrive <jobId>`; a linha de comando recusa importação real de rascunho.
6. Revise avisos e erros do relatório. Reimportar é seguro, mas pula o que foi editado no Oxyn.
7. Depois da primeira carga real, confira o plano de execução do filtro por etiqueta (pendência da fase 3).

## Pendências carregadas das fases anteriores

- Validação de aplicação do zero: as migrações das fases 3 e 4 foram editadas no lugar e reaplicadas à mão. Falta resetar o banco de dev e aplicar `supabase/migrations/` inteiro (até `20261026000007`, a última da fase 3.5) para descartar deriva. Exige o OK do dono do projeto para o reset do banco de dev.
- Merge dos PRs empilhados (fases 2, 3, 4, 6 e 3.5), em ordem, antes de qualquer deploy.
- Produção: projeto Supabase de produção com migrações aplicadas, usuário admin geral e variáveis da Vercel (inclui `PIPEDRIVE_API_TOKEN`). Confira que a rotina `generate_activity_reminders` (pg_cron) está agendada.
- `CRON_SECRET` no `.env.local` ainda é o valor de exemplo. Troque por um valor aleatório de verdade antes da produção (por exemplo, `openssl rand -hex 32`) e nunca o imprima nem o grave em arquivo versionado. Defina também `CRON_SECRET` e `NEXT_PUBLIC_SITE_URL` na Vercel.
- Plano da Vercel: o cron `*/5 * * * *` exige Pro. No Hobby, agendar `GET /api/cron/lembretes` via pg_cron + pg_net com `Authorization: Bearer <CRON_SECRET>`. A importação pela web também depende do limite de duração da função (`maxDuration` 60 s); em planos menores, use a linha de comando.
- Demais melhorias das fases 3, 4 e 6 continuam valendo nos respectivos documentos.
