# Oxyn CRM

CRM multiempresa da Oxyn (Next.js 16 e Supabase hospedado). A fase 1 entrega a fundação: login, convites, empresas, usuários, papéis com permissões, equipes e perfil. A fase 2 entrega Contatos e Leads. A fase 3 entrega o funil de vendas e a receita (módulo Negócios). A fase 4 entrega as Atividades. A fase 6 entrega Relatórios, dashboards e metas. A fase 3.5 entrega a importação do Pipedrive.

- Especificação: [docs/superpowers/specs/2026-10-21-oxyn-crm-design.md](docs/superpowers/specs/2026-10-21-oxyn-crm-design.md)
- Plano da fase 1: [docs/superpowers/plans/2026-10-21-fase-1-fundacao.md](docs/superpowers/plans/2026-10-21-fase-1-fundacao.md)
- Pendências da fase 3.5: [docs/superpowers/followups/2026-10-26-fase-3-5-pendencias.md](docs/superpowers/followups/2026-10-26-fase-3-5-pendencias.md)
- Pendências da fase 6: [docs/superpowers/followups/2026-10-25-fase-6-pendencias.md](docs/superpowers/followups/2026-10-25-fase-6-pendencias.md)
- Pendências da fase 4: [docs/superpowers/followups/2026-10-24-fase-4-pendencias.md](docs/superpowers/followups/2026-10-24-fase-4-pendencias.md)
- Pendências da fase 3: [docs/superpowers/followups/2026-10-23-fase-3-pendencias.md](docs/superpowers/followups/2026-10-23-fase-3-pendencias.md)
- Pendências da fase 2: [docs/superpowers/followups/2026-10-22-fase-2-pendencias.md](docs/superpowers/followups/2026-10-22-fase-2-pendencias.md)

## Módulos

Depois da fase 4, cada empresa tem:

- **Leads**: caixa de leads com abas por status (abertos, desqualificados, arquivados), idade do lead, valor estimado, origem, vínculo com pessoa e organização, desqualificação com motivo e reabertura. Um lead aberto converte em negócio (a pessoa, a organização, o valor e as etiquetas vão junto) e passa a aparecer na aba Convertidos.
- **Negócios**: funis com etapas configuráveis, em quatro partes.
  - **Kanban**: colunas com contagem e soma, cards arrastáveis, selo de negócio esfriando, filtros por responsável, equipe e etiqueta, e rodapé de arraste para Ganho, Perdido e Excluir. Se a etapa de destino exige campos que faltam, um diálogo pede só o que falta e conclui o movimento.
  - **Lista e forecast**: lista paginada com abas Abertos, Ganhos e Perdidos e exportação em CSV; forecast por mês de fechamento esperado, com opção de ponderar pela probabilidade da etapa. "Todas as empresas" abre a lista.
  - **Detalhe do negócio**: barra de etapas, ganho, perdido (com motivo) e reabertura, produtos (setup e recorrente), condições de contrato e cronograma de receita mês a mês. Com produtos, os totais vêm dos itens.
  - **Conversão de lead**: do lead para um negócio no funil e na etapa escolhidos.
  - **Configurações** (por empresa): funis e etapas (ordem por arrastar, probabilidade, prazo para esfriar, campos obrigatórios, campo exibido no card), catálogo de produtos e motivos de perda. Campos personalizados também valem para Negócios.
- **Atividades**: tarefas, ligações, reuniões, e-mails e mensagens, cada uma com tipo, canal obrigatório (por exemplo LinkedIn) e vínculo com lead, negócio, pessoa ou organização.
  - **Conclusão com resultado**: nenhuma atividade conclui sem resultado, em qualquer caminho. Um resultado que agenda reunião cria a reunião já com o canal de origem; reuniões fecham como Realizada, No-show, Remarcada ou Cancelada.
  - **Próxima atividade**: regra Desligada, Sugerir ou Obrigar por funil e para os leads da empresa; com Obrigar o diálogo só conclui junto da nova atividade.
  - **Lista e agenda** (`/atividades`): abas Atrasadas, Hoje e Próximas, e visões de lista, semana e mês. Atrasadas aparecem em vermelho na agenda, no card do kanban e nos painéis. Horários em America/Sao_Paulo.
  - **Kanban e leads**: o card mostra a próxima atividade, há filtro de negócios com atividade atrasada, e a caixa de leads mostra Próxima atividade e Último canal.
  - **Configurações** (admin geral, por empresa): tipos, canais e resultados de atividade e a regra de próxima atividade dos leads.
- **Contatos**: **Pessoas** (vários e-mails e telefones, link de WhatsApp, organização vinculada) e **Organizações** (CNPJ, domínio, segmento). Listas paginadas no servidor, com filtros, ordenação, colunas configuráveis e exportação em CSV conforme a permissão. A visão "Todas as empresas" reúne os registros que o usuário pode ver. Avisos de duplicidade não expõem dados de quem não tem acesso.
- **Registros**: etiquetas, campos personalizados, anotações e linha do tempo unificada em cada ficha, além de troca de responsável com permissão.
- **Busca global** (Ctrl+K): encontra leads, negócios, pessoas e organizações e leva à lixeira.
- **Lixeira**: registros excluídos ficam 30 dias e podem ser restaurados; a exclusão definitiva é automática após o prazo ou manual, só pelo admin geral.
- **Configurações** (admin geral, por empresa): campos personalizados, etiquetas, origens de lead, motivos de desqualificação, funis, produtos e motivos de perda.

## Relatórios, dashboards e metas

O menu Relatórios (`/<empresa>/relatorios`) reúne relatórios prontos, o construtor de relatórios personalizados, dashboards e metas. Toda consulta roda em funções do banco, que aplicam a visibilidade de quem consulta; nenhuma consulta é montada no front.

- **Relatórios**: bases leads, negócios, atividades, receita e histórico de etapas (a base "e-mails" fica para depois da fase 5). Métricas: quantidade, soma, média, taxa de conversão e tempo médio. Gráficos: número, barras, linha, funil, pizza e tabela. Prontos: Funil de reuniões por canal, Sucesso por canal, Influência na conversão, Conversão por etapa, Forecast, Receita mês a mês, Visão do funil, Idade, Atividades por usuário, Motivos de perda e Progresso de metas.
- **Dashboards** (`/<empresa>/relatorios/dashboards`): grade de widgets que se reordenam por arrastar e mudam de tamanho pela alça (ou pelas setas do teclado), com filtro global de período e, em "Todas as empresas", de empresa.
- **Metas** (`/<empresa>/relatorios/metas`): metas por empresa, usuário ou equipe, com as métricas reuniões agendadas, reuniões realizadas, oportunidades criadas, valor ganho, MRR ganho e atividades concluídas, em períodos semanal, mensal ou trimestral. As metas são criadas e excluídas só pelo admin geral; qualquer membro da empresa com acesso a Relatórios vê o progresso, calculado só sobre o que ele enxerga.

### Permissões

São três chaves em `roles.permissions.settings`, por papel e por empresa. O admin geral tem todas.

- `view_reports`: libera o menu Relatórios, os relatórios prontos, o construtor e as metas.
- `create_dashboards`: libera criar dashboards e adicionar widgets.
- `share_dashboards`: libera compartilhar com usuários e criar link público.

### Quem vê o quê

- **Dashboard próprio**: os números respeitam a visibilidade de quem abre (papel, equipe e empresas).
- **Dashboard compartilhado com usuários**: o destinatário vê os números com o alcance do criador, não com o dele, em modo somente leitura. Só dá para compartilhar com quem divide empresa com o dono. O destinatário abre o dashboard mesmo sem `view_reports`. Os filtros do destinatário só restringem; nunca ampliam o alcance do criador.
- **Link público** (`/d/<token>`): abre sem login, também com o alcance do criador, em somente leitura. O token é mostrado uma única vez ao criar o link e só o hash fica no banco. O link pode ter validade e ser revogado a qualquer momento; se o criador perder o acesso ou a permissão de compartilhar, o link deixa de abrir. A página tem `noindex` e `no-referrer`.

`NEXT_PUBLIC_SITE_URL` é obrigatório para gerar os links (a ação de criar o link falha sem ela, para nunca apontar para localhost): `http://localhost:3000` em dev e o domínio em produção.

### Semântica dos filtros

- Filtro ausente significa sem filtro; uma lista vazia significa nada (nenhum registro). A interface omite a chave quando nada foi escolhido.
- Os filtros do dashboard (período, empresa, responsável, equipe) só restringem o que o relatório já mostra. O período do relatório é o limite; o filtro global não o amplia.
- Um widget de relatório salvo respeita a empresa em que o relatório foi salvo, mesmo em "Todas as empresas".
- Tabelas cortam em 500 linhas e avisam quando cortaram.
- No funil por canal, um lead com reuniões em canais diferentes conta em cada canal, então as linhas não somam.

## Importação do Pipedrive

Traz funis, etapas, usuários, campos personalizados, organizações, pessoas, leads (inclusive arquivados), negócios, produtos, atividades e anotações do Pipedrive para o Oxyn. Só o admin geral usa: `/configuracoes/importacao`.

### Variáveis de ambiente

- `PIPEDRIVE_API_TOKEN`: token da API do Pipedrive. Vive só em `.env.local` ou nas variáveis da Vercel, lido no servidor. Nunca é gravado no banco, nunca vai para o navegador e nunca aparece em log. A autenticação usa o cabeçalho `x-api-token`.
- `PIPEDRIVE_BASE_URL`: opcional, padrão `https://api.pipedrive.com`. Serve para os testes apontarem para o servidor falso.

### Assistente

1. **Funis**: para cada funil do Pipedrive, importar ou ignorar, empresa de destino, funil de destino (existente ou novo) e mapeamento de cada etapa.
2. **Usuários**: cada usuário do Pipedrive aponta para um usuário do Oxyn.
3. **Etiquetas de lead**: a etiqueta de empresa do lead decide a empresa dele.
4. **Padrões**: empresa padrão para registros sem empresa definida (órfãos) e demais padrões.
5. **Campos personalizados**: destino e chave de cada campo.
6. **Revisão**: confere tudo e oferece **Simular (sem gravar)** ou **Iniciar importação**.

A importação roda em fatias de cerca de 10 s, com progresso na tela, e pode ser retomada de onde parou. O relatório final traz contagens, avisos e erros.

### Simular

Roda o motor inteiro sem gravar nada no banco, para achar problemas de mapeamento. A simulação tem teto de 45 s: se não terminar nesse tempo, o resultado é parcial e a tela avisa. Para uma simulação completa de uma base grande, use a linha de comando.

### Linha de comando

```bash
pnpm import:pipedrive <jobId> [--dry-run]
```

Continua um job já configurado no assistente, sem o limite de tempo da web. Com `--dry-run` não grava nada.

### Como as empresas são definidas

- Negócio: o funil mapeado define a empresa.
- Lead: a etiqueta de empresa define a empresa. Sem etiqueta de empresa, vai para a empresa padrão.
- Pessoas e organizações ligadas a mais de uma empresa são duplicadas, uma cópia por empresa (isolamento entre empresas). Sem vínculo, vão para a empresa padrão.
- Atividades e anotações seguem o negócio ou lead vinculado; os de contato valem para cada empresa do contato.

### Conferência de donos

Antes de gravar, a etapa `users_check` exige que o dono de cada negócio e de cada lead seja membro da empresa de destino; senão o job falha listando "Nome (Empresa)". Contatos e atividades cujo dono não é membro vão para um dono de reserva, com um aviso agregado.

### Reimportação

Reimportar não duplica: cada registro é casado pelo id do Pipedrive. Registro editado no Oxyn depois da importação é pulado, para não sobrescrever o trabalho no CRM. Quem alterar algo no Pipedrive depois da migração e já tiver editado o registro no Oxyn não verá a mudança.

### Atividades legado

Atividades importadas ficam marcadas como legado. O canal é deduzido pelo tipo do Pipedrive (ligação, e-mail, LinkedIn, WhatsApp); sem correspondência, vai para o canal legado "Não informado". Concluídas sem resultado recebem o resultado "Importado". A importação não grava eventos falsos na linha do tempo.

### Trava

Só uma execução por job de cada vez: cada fatia toma uma concessão de 120 s, renovada a cada passo. Se o assistente e a linha de comando competirem, o segundo recebe "ocupado". Se uma execução cair, a concessão expira sozinha em até 120 s.

## Lembretes de atividades

Atividades com lembrete geram uma notificação (função `generate_activity_reminders`, agendada no pg_cron a cada minuto). O sino na barra superior mostra as não lidas em tempo real (Supabase Realtime) e abre um aviso com o botão "Abrir".

O e-mail do lembrete sai pela rota `GET /api/cron/lembretes`, que exige `Authorization: Bearer $CRON_SECRET` e envia só notificações dos últimos 60 minutos ainda sem e-mail. O `vercel.json` agenda a rota a cada 5 minutos; na Vercel, defina `CRON_SECRET` nas variáveis do projeto (a Vercel envia o cabeçalho sozinha). Atenção: o cron de 5 em 5 minutos exige Vercel Pro; no Hobby, agendar a rota via pg_cron + pg_net com o header Bearer.

Configuração:

- `CRON_SECRET`: segredo da rota de e-mail. Na Vercel, nas variáveis do projeto; localmente, em `.env.local` (sem ele a rota responde 401 e o teste E2E do e-mail é ignorado).
- `NEXT_PUBLIC_SITE_URL`: base dos links do e-mail (`http://localhost:3000` em dev, o domínio em produção).
- `REMINDERS_URL`: opcional, endereço que o `pnpm reminders:send` chama (padrão: `http://localhost:3000`).
- pg_cron: a notificação em si nasce da rotina `generate_activity_reminders`, agendada pelas migrações a cada minuto; confira que ela está ativa no banco de produção.
 Localmente, defina `CRON_SECRET` em `.env.local` e rode `pnpm reminders:send` (use `REMINDERS_URL` para apontar a outro endereço; o e-mail vai para `.e2e-outbox/emails.jsonl` com `EMAIL_TRANSPORT=file`).

## Desenvolvimento

Pré-requisitos: Node 22 e pnpm. Não é preciso Docker: o banco é um projeto Supabase de desenvolvimento.

1. Crie um projeto Supabase de DEV (supabase.com).
2. Copie `.env.example` para `.env.local` e preencha:
   - `NEXT_PUBLIC_SUPABASE_URL`: Project Settings > API > Project URL.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Project Settings > API Keys, chave anon (publishable).
   - `SUPABASE_SERVICE_ROLE_KEY`: Project Settings > API Keys, chave service_role (secret). Nunca exponha no navegador.
   - `SUPABASE_DB_URL`: botão Connect > Session pooler, URI com a senha do banco.
   - `NEXT_PUBLIC_SITE_URL`: `http://localhost:3000`.
3. Instale e prepare o banco:

```bash
pnpm install
pnpm db:migrate   # aplica as migrações no projeto de dev
pnpm db:seed      # admin@oxyn.test / oxyn-dev-123 e empresas Oxyn e Volt
pnpm dev
```

Em desenvolvimento os e-mails (convite, recuperação de senha) não são enviados: ficam em `.e2e-outbox/emails.jsonl`, uma mensagem JSON por linha, com o link de acesso.

## Testes

```bash
pnpm test                              # unitários
pnpm test:db                           # pgTAP no projeto de dev; cada arquivo faz rollback
pnpm exec playwright install chromium  # uma vez
pnpm test:e2e                          # ponta a ponta
```

Os testes de banco e os E2E usam o mesmo projeto de dev, com dados prefixados por `tst-`.

## Produção (Supabase)

1. Crie um projeto separado do de dev. Recomendado: região São Paulo.
2. Aplique as migrações, com a URI do Session pooler de produção:

```bash
pnpm supabase db push --db-url "<URI do pooler de produção>"
```

   Alternativa: `pnpm supabase link --project-ref <ref>` seguido de `pnpm supabase db push`.
3. No painel, em Authentication, configure (obrigatório):
   - Desligar "Allow new users to sign up". Só o admin geral convida.
   - Tamanho mínimo de senha: 8.
   - Site URL: o domínio de produção.
   - Redirect URLs: `<domínio>/auth/confirm` e `<domínio>/auth/callback`.
4. Login com Google: em Authentication > Providers, habilite Google com o client ID e o secret do cliente OAuth da Oxyn no Google Cloud. Nele, cadastre a URI de redirecionamento `https://<ref>.supabase.co/auth/v1/callback`.

Não é preciso configurar templates de e-mail no Supabase: o app envia os próprios e-mails.

## E-mail (Resend)

Configure na Vercel:

- `EMAIL_TRANSPORT=resend`
- `RESEND_API_KEY`: chave da API do Resend.
- `EMAIL_FROM`: remetente de um domínio verificado no Resend, por exemplo `Oxyn CRM <nao-responda@seudominio.com.br>`.

Em produção, sem `EMAIL_TRANSPORT` o app se recusa a enviar e-mails.

## Vercel

Importe o repositório e defina as variáveis (as mesmas de `.env.example`, com valores de produção):

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL` (domínio de produção), `EMAIL_TRANSPORT`, `RESEND_API_KEY`, `EMAIL_FROM`.

`SUPABASE_DB_URL` só é necessária para migrar e testar, não para o app.

## CI

O GitHub Actions (`.github/workflows/ci.yml`) roda lint, typecheck, testes unitários e build. Os passos de banco e E2E só rodam se os secrets do repositório existirem: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_DB_URL`. Eles usam o projeto de dev e as execuções são serializadas (um job por vez) para não disputar o mesmo banco.

## Primeiro acesso

Com as variáveis de produção exportadas no terminal (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY`, `EMAIL_FROM`):

```bash
pnpm bootstrap:admin caiocamarini@gmail.com "Caio Camarini"
```

O comando convida o e-mail e marca o usuário como admin geral. Se o usuário já existir, apenas o marca como admin geral. Abra o convite recebido, crie a senha e entre.

Se o envio do e-mail falhar, o usuário já foi criado e marcado como admin geral: corrija a configuração e rode o comando de novo. Enquanto o usuário não tiver confirmado o acesso, cada nova execução reenvia o convite ("Convite reenviado."). Em desenvolvimento, com `EMAIL_TRANSPORT` vazio, o link vai para `.e2e-outbox/emails.jsonl`.
