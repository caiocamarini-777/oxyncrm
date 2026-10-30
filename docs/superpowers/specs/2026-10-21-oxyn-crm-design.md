# Oxyn CRM: Design da plataforma

Data: 21/10/2026
Responsável: Caio Camarini
Status: aguardando revisão

## 1. Contexto e objetivo

A Oxyn é uma Business Converter™: opera a geração de pipeline e a operação comercial de clientes B2B de ciclo complexo. Hoje usa o Pipedrive. O Oxyn CRM substitui o Pipedrive com o mesmo padrão de usabilidade, mas desenhado para o modelo da Oxyn:

- **Uma instalação, várias empresas.** Cada cliente representado (Volt, Naia, Destro, Harpix etc.) é uma empresa (tenant) com funis, leads, negócios, contatos, produtos e metas próprios. A própria Oxyn é uma empresa como as outras.
- **Medição por canal.** A operação precisa saber qual canal (e-mail, telefone, LinkedIn, WhatsApp etc.) marca mais reuniões e quais reuniões viram oportunidade.
- **Previsibilidade de receita.** Forecast de fechamento e receita mês a mês, separando Setup (CAPEX) e MRR (OPEX), a partir das condições reais do contrato.
- **Transparência com o cliente.** O cliente acompanha a evolução por links de dashboard, sem acesso ao CRM.

A plataforma vai crescer conforme a necessidade da Oxyn. Este documento define a arquitetura geral, o modelo de dados de todas as fases e o detalhamento funcional de cada fase. Cada fase recebe o próprio plano de implementação.

### Critérios de sucesso

1. A equipe Oxyn opera todos os clientes no Oxyn CRM e desliga o Pipedrive após a importação.
2. Nenhum usuário vê dados fora do seu alcance de permissão, comprovado por testes automatizados no banco.
3. A gestão responde, por cliente e por período: taxa de reunião por canal, conversão de reunião em oportunidade por canal, forecast de fechamento e receita prevista mês a mês (Setup e MRR).
4. Clientes acompanham dashboards por link público, revogável.

### Fora do escopo inicial

- Login para pessoas do cliente (acesso do cliente é só via link de dashboard).
- Cadências automatizadas (fase 7, futura).
- Aplicativo mobile nativo (a interface web deve funcionar bem em tablet; celular é desejável, não obrigatório).
- Faturamento ou cobrança real. O cronograma de receita é previsão, não gera boleto.

## 2. Decisões de arquitetura

| Tema | Decisão |
|---|---|
| Front e servidor | Next.js (App Router, TypeScript), hospedado na Vercel |
| Banco, auth, realtime, jobs | Supabase: Postgres, Supabase Auth, Realtime, Edge Functions, pg_cron |
| Segurança multiempresa | Row Level Security em todas as tabelas, com função central de permissão |
| UI | Tailwind CSS + shadcn/ui com tema Oxyn |
| Kanban | dnd-kit + Framer Motion |
| Tabelas | TanStack Table; dados com TanStack Query |
| Gráficos | Apache ECharts |
| Testes | pgTAP (banco e RLS), Vitest (lógica), Playwright (ponta a ponta) |
| CI | GitHub Actions rodando os três níveis de teste |
| Ambientes | Supabase local via CLI (Docker) para desenvolvimento; projeto Supabase de produção na org da Oxyn; migrações versionadas em `supabase/migrations` |

Alternativas descartadas: SPA React pura com Supabase (lógica de Gmail, links públicos e lembretes ficaria espalhada em funções soltas) e backend NestJS separado (o dobro de código sem ganho para o momento).

**Princípio:** toda regra que protege dado ou integridade (permissão, campos obrigatórios por etapa, resultado obrigatório de atividade, duração de contrato) é aplicada no banco. A interface repete as validações para dar boa experiência, mas nunca é a única barreira.

## 3. Identidade visual

Fonte: `OXYN_GUIA_EDITORIAL.docx`, seção 10.

- Teal (único accent): `#1A82A2` (primário), `#6498A8`, `#75ACBA`.
- Fundos escuros institucionais: `#111D17`, `#06090F`, `#0C0C0C`.
- Proibido: âmbar, dourado, laranja. Estados de alerta usam vermelho e cinza neutros, nunca laranja.
- Tipografia: Montserrat (títulos, números de destaque, caixa alta em rótulos de seção); Inter (corpo, tabelas, formulários); Barlow como apoio opcional.
- Textos da interface em português do Brasil, diretos, sem emoji e sem travessão.
- Logo: `oxyn_mark.png` (pasta `_scratch_assets` do projeto Oxyn).

## 4. Modelo de dados

Convenções para toda tabela de negócio: `id uuid`, `company_id`, `owner_id` (responsável), `created_by`, `created_at`, `updated_at`, `deleted_at` (lixeira), `custom_fields jsonb` quando a entidade aceita campos personalizados.

### 4.1 Acesso (fase 1)

| Tabela | Campos principais |
|---|---|
| `companies` | nome, slug, logo, CNPJ, moeda padrão (BRL), configurações (ex.: regra de próxima atividade na etapa de leads) |
| `profiles` | id (= `auth.users.id`), nome, e-mail, avatar, `is_super_admin`, `active` |
| `roles` | nome, descrição, `permissions jsonb` (ver 5.2); papel "Usuário padrão" criado por seed |
| `teams` | nome |
| `team_members` | team_id, user_id |
| `memberships` | user_id, company_id, role_id; único por (user, company) |
| `invitations` | e-mail, empresas e papéis pré-definidos, token, expiração |
| `audit_log` | entidade, registro, ação, usuário, antes/depois, data |

### 4.2 Contatos e leads (fase 2)

| Tabela | Campos principais |
|---|---|
| `organizations` | nome, razão social, CNPJ, domínio, segmento, endereço |
| `persons` | nome, cargo, `emails` (lista com rótulo), `phones` (lista com rótulo), organization_id, LinkedIn |
| `leads` | título, origem, person_id, organization_id, valor estimado, status (`open`, `converted`, `disqualified`, `archived`), motivo de desqualificação, `converted_deal_id`, `converted_at` |
| `lead_sources` | origens configuráveis por empresa |
| `disqualification_reasons` | motivos configuráveis por empresa |
| `labels` + `record_labels` | etiquetas coloridas por empresa e vínculo polimórfico |
| `custom_field_defs` | company_id, entidade, chave, rótulo, tipo (`text`, `number`, `money`, `date`, `select`, `multiselect`, `user`), opções, ordem |
| `notes` | conteúdo (rich text), vínculo a lead, negócio, pessoa ou organização |
| `timeline_events` | evento unificado por registro (criação, edição relevante, mudança de etapa, atividade, e-mail, anotação) |

### 4.3 Negócios, funis e receita (fase 3)

| Tabela | Campos principais |
|---|---|
| `pipelines` | company_id, nome, ordem, `next_activity_rule` (`off`, `suggest`, `require`), campo exibido no card (`total`, `mrr`, `setup`) |
| `stages` | pipeline_id, nome, ordem, probabilidade (%), `rotting_days`, `required_fields` (lista de chaves de campo padrão ou personalizado) |
| `deals` | título, pipeline_id, stage_id, status (`open`, `won`, `lost`), motivo de perda, person_id, organization_id, lead_id de origem, `expected_close_date`, `stage_entered_at`, `won_at`, `lost_at`, posição no kanban, condições de contrato (abaixo) |
| `lost_reasons` | motivos configuráveis por empresa |
| `products` | company_id, nome, tipo (`setup`, `recurring`), preço padrão, ativo |
| `deal_items` | deal_id, product_id, quantidade, preço unitário, desconto, tipo herdado do produto |
| `deal_stage_history` | deal_id, from_stage, to_stage, moved_by, moved_at, tempo na etapa anterior |
| `deal_revenue_schedule` | deal_id, mês (primeiro dia), valor setup, valor MRR; gerado pelo banco |

**Condições de contrato no negócio:**

- `setup_total`: soma dos itens de setup, ou valor digitado quando não há itens.
- `setup_installments` (≥ 1) e `setup_first_due` (mês da 1ª parcela).
- `mrr`: soma dos itens recorrentes, ou valor digitado.
- `mrr_start` (mês de início) e `contract_months` (≥ 1).
- **Regra:** se `mrr > 0`, `mrr_start` e `contract_months` são obrigatórios. Não existe prazo indeterminado. Se `setup_total > 0`, `setup_first_due` é obrigatório.
- `contract_value` (calculado) = `setup_total + mrr × contract_months`.

**Cronograma de receita:** um trigger regenera `deal_revenue_schedule` sempre que as condições mudam. Parcelas de setup: `setup_total / setup_installments` por mês a partir de `setup_first_due` (centavos residuais na última parcela). MRR: `mrr` por mês de `mrr_start` até `mrr_start + contract_months - 1`.

### 4.4 Atividades (fase 4)

| Tabela | Campos principais |
|---|---|
| `activity_types` | tarefa, ligação, reunião, e-mail, mensagem; configuráveis por empresa; flag `is_meeting` |
| `activity_channels` | canais configuráveis por empresa (seed: E-mail, Telefone, LinkedIn, WhatsApp, Videochamada, Presencial) |
| `activity_outcomes` | resultados configuráveis por empresa, cada um com `classification` (`success`, `neutral`, `failure`) e flag `books_meeting` |
| `meeting_outcomes` | seed: Realizada (`held`), No-show, Remarcada, Cancelada |
| `activities` | tipo, canal (obrigatório), assunto, descrição, `due_at`, duração, `done`, `completed_at`, outcome_id, nota de conclusão, vínculos (lead, deal, person, organization), `reminder_minutes`, `booked_by_activity_id` (reuniões), `origin_channel_id` (herdado) |

### 4.5 E-mail (fase 5)

| Tabela | Campos principais |
|---|---|
| `email_accounts` | user_id, company_id, endereço, tokens OAuth criptografados (Supabase Vault), `history_id`, status, visibilidade padrão (`shared`, `private`) |
| `email_threads` | account_id, gmail_thread_id, assunto, último envio |
| `email_messages` | thread_id, gmail_message_id, de, para, cc, data, trecho, corpo (HTML sanitizado), anexos (metadados) |
| `email_links` | thread_id, entidade vinculada, origem do vínculo (`auto`, `manual`), quem vinculou |
| `email_templates` | company_id, nome, assunto, corpo com variáveis |

### 4.6 Relatórios e metas (fase 6)

| Tabela | Campos principais |
|---|---|
| `reports` | company_id (ou nulo para "todas"), owner, nome, `spec jsonb` (base, métrica, agrupamento, filtros, gráfico) |
| `dashboards` | owner, nome, filtros globais padrão |
| `dashboard_widgets` | dashboard_id, report_id ou spec embutido, posição e tamanho na grade |
| `dashboard_shares` | dashboard_id, user_id |
| `dashboard_share_links` | dashboard_id, token (hash), criado por, expiração opcional, revogado em |
| `goals` | company_id, alvo (user ou team), métrica, período (`week`, `month`, `quarter`), início, valor-alvo |

### 4.7 Importação Pipedrive (fase 3.5)

| Tabela | Campos principais |
|---|---|
| `import_jobs` | origem, status, mapeamentos, contadores, log de erros |
| `external_ids` | entidade, registro, sistema de origem, id externo (garante reimportação sem duplicar) |

## 5. Permissões

### 5.1 Níveis

- **Admin geral** (`profiles.is_super_admin`): vê e faz tudo em todas as empresas; único que cria empresas, papéis e convida usuários; único que exclui definitivamente.
- **Papéis** (`roles`): conjuntos configuráveis de permissões. Um usuário tem um papel por empresa (`memberships`). A mesma pessoa pode ter papéis diferentes em empresas diferentes.
- **Equipes** (`teams`): grupos de usuários usados pela visibilidade "equipe".

### 5.2 Conteúdo de `roles.permissions`

```json
{
  "visibility": {
    "leads": "own | team | company",
    "deals": "own | team | company",
    "persons": "own | team | company",
    "organizations": "own | team | company",
    "activities": "own | team | company"
  },
  "actions": {
    "create": true, "edit": true, "delete": false,
    "export": false, "reassign_owner": false
  },
  "settings": {
    "manage_pipelines": false, "manage_custom_fields": false,
    "manage_products": false, "view_reports": true,
    "create_dashboards": true, "share_dashboards": false
  }
}
```

O papel "Usuário padrão" vem com `own` em todas as entidades. A tela de papéis exibe cada chave como um interruptor.

### 5.3 Aplicação

- Função `can_access(company_id, entity, owner_id, action) returns boolean` (`security definer`, `stable`), usada pelas políticas RLS de todas as tabelas de negócio. Lógica: admin geral → sim; sem membership na empresa → não; visibilidade `company` → sim; `team` → sim se o responsável divide alguma equipe com o usuário ou é o próprio usuário; `own` → sim se for o responsável.
- Registros filhos (itens do negócio, cronograma, histórico, anotações, links de e-mail) herdam a permissão do registro pai.
- **Duplicidade:** função `check_duplicates(company_id, entity, emails, phones, cnpj, domain)` (`security definer`) devolve só "existe, responsável: Nome", sem dados do registro.
- **Dashboards:**
  - Não compartilhado: consultas rodam com a identidade de quem vê.
  - Compartilhado com usuários ou por link: consultas rodam com o alcance do criador, restritas aos widgets daquele dashboard. Quem recebe pode aplicar filtros que restringem, nunca que ampliam.
  - Compartilhar exige `share_dashboards`. Links públicos usam token aleatório (armazenado como hash), podem expirar e ser revogados.
- **Usuário desativado** perde acesso imediato (sessões invalidadas); seus registros permanecem para reatribuição.
- **Convites:** não há cadastro aberto. Admin convida por e-mail com empresas e papéis já definidos. Login por e-mail e senha ou Google.

## 6. Fases e funcionalidades

> Módulo Financeiro (fluxo de caixa, contratos, despesas e vendas): especificação própria em [2026-10-29-financeiro-design.md](2026-10-29-financeiro-design.md).

### Fase 1: Fundação

- Login, convite, recuperação de senha, perfil.
- Cadastro de empresas (admin geral).
- Usuários: convidar, ativar/desativar, definir empresas e papel por empresa.
- Papéis com interruptores (5.2). Equipes.
- Layout base: barra lateral escura (`#111D17`) com Leads, Negócios, Atividades, Contatos, E-mail, Relatórios, Configurações; item ativo em teal. Topo com seletor de empresa (inclui "Todas as empresas" para quem tem mais de uma), busca global, botão "+" e avatar. Área de trabalho clara; modo escuro opcional.
- Auditoria básica.

### Fase 2: Leads, pessoas e organizações

- Listas em tabela com filtros, ordenação, colunas configuráveis e exportação (se o papel permitir).
- Telas de detalhe no padrão Pipedrive: coluna esquerda com dados e campos personalizados; centro com abas (atividade, anotação, e-mail) e linha do tempo (planejado no topo, histórico abaixo).
- Campos personalizados por empresa e entidade. Etiquetas. Anotações.
- Aviso de duplicidade ao criar pessoa ou organização.
- Lead: converter em negócio (escolhe funil e etapa; pessoa, organização, valor e atividades migram) ou desqualificar (motivo obrigatório).
- Reatribuir responsável (com permissão), lixeira de 30 dias.

### Fase 3: Funis, kanban, produtos e receita

- Configuração de funis e etapas: ordem por arrastar, probabilidade, dias para esfriar, campos obrigatórios por etapa, regra de próxima atividade, campo exibido no card.
- **Kanban:**
  - Colunas com nome, quantidade e soma (total, MRR ou Setup).
  - Card: título, organização, valor, avatar do responsável, indicador da próxima atividade (vermelho atrasada, cinza ausente), selo "esfriando".
  - Arrastar: card levanta com sombra e leve inclinação, colunas abrem espaço com animação, encaixe suave ao soltar. Movimento otimista.
  - Campos obrigatórios faltando: card volta à origem com animação de tremor e abre modal com os campos pendentes; ao salvar, o movimento se completa.
  - Barra de rodapé durante o arraste: Ganho, Perdido (motivo obrigatório), Excluir.
  - Filtros: funil, responsável, equipe, etiqueta, atividades atrasadas.
- Visões alternativas: lista e forecast (colunas por mês de fechamento esperado).
- Detalhe do negócio: barra de etapas clicável, Ganho/Perdido, produtos, condições de contrato e cronograma de receita mês a mês.
- Catálogo de produtos por empresa. Motivos de perda.
- Trigger de banco valida campos obrigatórios ao mudar de etapa e registra `deal_stage_history`.

### Fase 3.5: Importação do Pipedrive

- Assistente de importação (admin geral) usando a API do Pipedrive.
- Mapeamento: cada funil do Pipedrive → empresa e funil do Oxyn CRM; usuários do Pipedrive → usuários do Oxyn CRM; campos personalizados → campos personalizados.
- Importa organizações, pessoas, leads, negócios (com etapa, status, valor, datas), atividades, anotações e produtos.
- Atividades importadas recebem canal deduzido pelo tipo quando possível, ou canal "Não informado", e ficam marcadas como legado (fora das métricas de canal por padrão).
- Reimportável sem duplicar (`external_ids`). Relatório final com contagens e erros.

### Fase 4: Atividades

- Criar atividade: tipo, **canal obrigatório**, data e hora, duração, vínculos, lembrete.
- **Concluir exige resultado** (modal com resultado e nota opcional). Não há conclusão sem resultado.
- Resultado com `books_meeting` (ex.: "Reunião agendada") exige criar a reunião no mesmo modal. A reunião guarda `booked_by_activity_id` e herda `origin_channel_id`.
- Reunião concluída exige resultado de reunião (Realizada, No-show, Remarcada, Cancelada).
- **Próxima atividade:** após concluir, conforme regra do funil (ou da etapa de leads da empresa): `off`, `suggest` (abre o formulário já preenchido, pode fechar) ou `require` (não fecha sem agendar, exceto se o negócio for ganho, perdido ou o lead desqualificado).
- Visões: lista (atrasadas, hoje, próximas), agenda semanal e mensal.
- Atrasadas destacadas em vermelho na agenda, no card do kanban e no painel do usuário.
- Lembretes: notificação no app (Realtime) e e-mail, disparados por pg_cron.

### Fase 5: Gmail

- Cada usuário conecta uma ou mais caixas Google Workspace; **cada caixa é associada a uma empresa**.
- Sincronização: importação inicial de 90 dias; depois incremental (Gmail History API) a cada 2 a 5 minutos via pg_cron + Edge Function. Push via Pub/Sub fica como melhoria.
- **Vínculo automático:** mensagens com endereços de pessoas ou domínios de organizações da empresa da caixa são salvas e aparecem na linha do tempo da pessoa, da organização e dos leads e negócios abertos dela.
- **Vínculo manual:** módulo E-mail exibe a caixa completa (lida ao vivo do Gmail, não salva), com busca. "Vincular a…" lead, negócio, pessoa ou organização, de qualquer domínio. A conversa passa a ser salva e sincronizada, incluindo respostas futuras. Oferece criar o remetente como pessoa. Desvincular fica registrado.
- Mensagens não vinculadas e sem correspondência no CRM não são armazenadas.
- Enviar e responder pelo CRM usando a conta Gmail do usuário, com modelos. Opção por empresa: e-mail enviado conta como atividade concluída no canal E-mail.
- Visibilidade por caixa: compartilhada com quem vê o registro (padrão) ou privada.
- Tokens criptografados no Supabase Vault, lidos só por Edge Functions.
- **Configuração Google:** app OAuth no projeto Google Cloud da Oxyn, tipo externo. Cada domínio de cliente precisa que o admin do Workspace marque o app como confiável (Admin Console, Segurança, Controles de API, Acesso a apps de terceiros). A spec de implementação da fase 5 inclui o passo a passo. Risco: escopos restritos do Gmail podem exigir verificação do Google se o uso sair de domínios que confiaram no app; validar no início da fase 5.

### Fase 6: Relatórios, dashboards e metas

- **Construtor de relatórios** com spec controlada (sem SQL livre):
  - Base: leads, negócios, atividades, receita (cronograma), histórico de etapas, e-mails.
  - Métrica: quantidade, soma (valor do contrato, Setup, MRR), média, taxa de conversão, tempo médio.
  - Agrupamento: usuário, equipe, empresa, funil, etapa, canal, resultado, mês, etiqueta, origem, campo personalizado.
  - Filtros e gráfico: número, barras, linha, funil, pizza, tabela.
  - Execução por função no banco que traduz a spec em SQL a partir de uma lista fechada de campos e operações, respeitando RLS.
- **Relatórios prontos:**
  - Funil de reuniões por canal: tentativas → reuniões agendadas → realizadas → viraram oportunidade → ganhas, com taxa entre etapas.
  - Taxa de sucesso por canal (classificação dos resultados).
  - Influência na conversão: canal da última atividade antes de lead convertido, avanço de etapa e ganho.
  - Conversão por etapa, por funil, usuário e período.
  - Forecast de fechamento: quantidade e valor previstos por mês (`expected_close_date`) e realizado contra previsto.
  - Receita mês a mês: contratada (negócios ganhos) e prevista (abertos, ponderada pela probabilidade da etapa), separando Setup e MRR.
  - Pipeline geral por funil e etapa.
  - Idade: dias desde criação e dias na etapa, por lead e negócio.
  - Atividades por usuário, motivos de perda, progresso de metas.
- **Dashboards:** grade de widgets arrastáveis e redimensionáveis, filtro global de período e empresa, compartilhamento com usuários e por link público (regras em 5.3).
- **Metas:** por empresa, usuário ou equipe; métricas: reuniões agendadas, reuniões realizadas, oportunidades criadas, valor ganho, MRR ganho, atividades concluídas; período semanal, mensal ou trimestral.

### Fase 7: Cadências (futura)

Sequências multicanal (ex.: D1 e-mail, D3 LinkedIn, D5 ligação) aplicadas a leads, gerando atividades com canal. Usa integralmente o modelo de canal e resultado da fase 4. Terá spec própria.

## 7. Tratamento de erros

- Ações otimistas (kanban, concluir atividade) revertem com animação e mensagem em português quando o banco recusa (permissão, campo obrigatório, conexão).
- Erros do banco usam códigos próprios (ex.: `OXYN_REQUIRED_FIELDS` com a lista de campos) que a interface traduz em formulário, não em mensagem genérica.
- Realtime atualiza kanban e telas abertas quando outro usuário altera o registro.
- Gmail: token expirado marca a caixa como "reconectar" e avisa o usuário; sincronização retoma pelo último `history_id`, idempotente por `gmail_message_id`.
- Importação: erros por registro vão para o log do job sem abortar o restante.

## 8. Testes

- **pgTAP:** matriz de permissões por entidade × visibilidade (`own`, `team`, `company`) × admin × sem membership; dashboard compartilhado e link público (alcance do criador, filtros só restringem); duplicidade sem vazamento; triggers de campos obrigatórios, duração de contrato, cronograma de receita, resultado obrigatório de atividade.
- **Vitest:** cálculo de cronograma e valor do contrato, tradução de spec de relatório, métricas de canal, regras de próxima atividade no front.
- **Playwright:** login e convite; criar lead → atividade → reunião agendada → reunião realizada → converter → arrastar no kanban (com e sem campos obrigatórios) → ganhar; concluir atividade exigindo resultado.
- CI no GitHub Actions com Supabase local.

## 9. Ordem de entrega

| Fase | Entrega | Resultado utilizável |
|---|---|---|
| 1 | Fundação | Equipe entra, admin configura empresas e acessos |
| 2 | Leads, pessoas, organizações | Base de contatos por cliente |
| 3 | Funis, kanban, produtos, receita | Pipeline operando com forecast de receita |
| 3.5 | Importação do Pipedrive | Operação migrada |
| 4 | Atividades com canal e resultado | Rotina de SDRs e closers medida por canal |
| 5 | Gmail | E-mails na linha do tempo |
| 6 | Relatórios, dashboards, metas | Gestão e acompanhamento dos clientes |
| 7 | Cadências | Sequências multicanal (futuro) |

Cada fase vai ao ar utilizável antes da seguinte. O plano de implementação é escrito por fase; o primeiro cobre a fase 1.

## 10. Pré-requisitos externos

- Acesso ao projeto Supabase de produção (URL, chave anon, chave service role) ou Supabase CLI autenticado na org da Oxyn.
- Conta Vercel conectada ao repositório.
- Projeto Google Cloud da Oxyn para OAuth (fase 5) e liberação do app pelo admin do Workspace de cada cliente.
- Token de API do Pipedrive (fase 3.5).
- Serviço de e-mail transacional (ex.: Resend) para convites e lembretes por e-mail.
- Recomendação: tornar o repositório `caiocamarini-777/oxyncrm` privado.
