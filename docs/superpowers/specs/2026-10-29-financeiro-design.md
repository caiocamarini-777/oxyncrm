# Financeiro (fluxo de caixa, contratos e projeção): design

Data: 2026-10-29. Substitui a planilha `2026_FINANCEIRO_OXYN.xlsx`.

## Objetivo

Controlar o que entra e o que sai do caixa da Oxyn e projetar faturamento e saldo bancário sem o limite de um ano da planilha.
- A projeção nasce das **vigências**: cada contrato e cada despesa recorrente sabe quando começa, quando termina e o que acontece no fim.
- Um negócio **ganho no CRM** vira um contrato no Financeiro sem redigitação.
- Toda visão pode ser filtrada por período, cliente, categoria de serviço, categoria de despesa, natureza do custo e conta.

Decisões do usuário (2026-10-29):
- O módulo é da Oxyn. Ele é ligado por empresa, para que o admin geral possa ativá-lo em outra empresa depois, se precisar.
- Cada contrato tem a sua regra de fim de vigência (encerra, renova, renova com reajuste, renovação a confirmar).
- A projeção considera só o que está fechado. Negócios em aberto do funil ficam de fora.
- As visões principais são o mês corrente e a projeção anual, por cliente (com share de receita) e por categoria de serviço.
- Custos fixos e variáveis aparecem separados.
- A **categoria de serviço** é um cadastro do CRM, mantido em Configurações, usado pelos produtos e pelos negócios e lido pelo Financeiro.
- O saldo bancário é informado à mão. A importação de extrato fica para depois.
- O acesso é restrito por uma permissão nova, porque o módulo mostra salários e pró-labore.
- As categorias de serviço iniciais são: Consultoria Vendas, Terceirização Vendas, Comissionamento, Consultoria Pessoas, Terceirização Pessoas e Serviço SEO/GEO.
- As categorias de despesa iniciais são os grupos da coluna B da aba Despesas. Categorias novas, de serviço e de despesa, são cadastradas de forma simples pelo admin.
- A carga inicial traz o realizado de 2026 das abas Despesas e Renda.
- Os impostos sobre o faturamento (ISS, DARF, IRPJ/CSLL) começam digitados, como despesas recorrentes ou avulsas. O cálculo automático fica para depois.
- O **comissionamento** vem sempre de vendas feitas dentro da operação de um cliente e sempre pertence a um contrato. A regra é cadastrada numa linha de receita do tipo Comissão, com % de setup e % de recorrência, e varia por contrato.
- As vendas são cadastradas à mão numa **tela de Vendas**, porque alguns clientes usam CRM próprio. Quem cadastra venda não vê o resto do Financeiro. A captura automática fica para depois.
- A comissão entra no caixa da Oxyn no mês seguinte ao recebimento do cliente.

Fora do escopo:
- Emissão de boleto ou nota fiscal e cobrança.
- Importação e conciliação de extrato (OFX/CSV).
- Negócios em aberto (forecast ponderado) na projeção.
- DRE contábil, regime de competência formal e várias moedas.
- Widgets do Financeiro no Insights e em dashboards compartilhados. Ficam fora para não abrir dados sensíveis por link ou por alcance do criador.
- Cálculo automático de impostos sobre a receita prevista (regras de imposto). Entra numa versão seguinte.
- Captura automática de vendas a partir dos negócios ganhos no CRM do cliente. Entra numa versão seguinte.

## Como a planilha é usada hoje

| Aba | Uso | O que muda |
|---|---|---|
| Renda | Receita por cliente × mês, com dia de pagamento | Vira contratos com vigência e parcelas geradas |
| Despesas | 12 grupos, fixas e variáveis, com dia de vencimento | Vira despesas recorrentes, avulsas e categorias |
| Previsão do mês | Agenda de pagamentos por dia com "ok" | Vira a visão Mês, com baixa de cada lançamento |
| Resumo | Receita − despesas e "saldo" acumulado a partir de zero | Vira a Projeção, partindo do saldo real informado |
| Estudo Investimentos | Aportes e reembolsos de sócios | Lançamentos avulsos, numa categoria que o admin cria se precisar |

Problemas resolvidos: saldo que não parte do banco, realizado e previsto misturados na mesma célula, digitação dupla entre Despesas e Previsão, fórmulas `#REF!` e projeção presa a jan–dez.

## Conceitos

- **Contrato**: o que gera receita. Tem cliente, linhas (setup, recorrente e comissão), dia de vencimento, retenção de impostos e regra de fim de vigência.
- **Venda do cliente**: uma venda que o cliente fez na operação que a Oxyn toca, cadastrada na tela de Vendas. Ela é a base de cálculo da linha de comissão do contrato.
- **Despesa recorrente**: o que gera custo repetido. Tem valor, periodicidade, dia, início, fim opcional, reajuste e número de parcelas (para parcelamentos).
- **Lançamento**: uma entrada ou saída com data e valor. Os lançamentos são gerados por contratos e despesas recorrentes, ou criados à mão (avulsos). Cada um é `aberto` (previsto) ou `liquidado` (pago ou recebido de fato).
- **Natureza** de uma saída: `fixed` (fixa), `variable` (variável) ou `non_recurring` (não recorrente: obras, móveis, equipamentos). A natureza não recorrente evita que investimentos pontuais distorçam o custo fixo.
- **Saldo informado**: um valor por conta numa data, digitado pelo usuário. A projeção parte do último saldo informado.

## Modelo de dados

Todas as tabelas têm `company_id`, `created_at`, `created_by`, `updated_at` e RLS. Valores em `numeric(14,2)`.

### No CRM

| Tabela | Mudança |
|---|---|
| `companies` | `finance_enabled boolean not null default false`. Só o admin geral altera. |
| `service_categories` (nova) | company_id, nome, cor, ordem, ativo. Seed na Oxyn: Consultoria Vendas, Terceirização Vendas, Comissionamento, Consultoria Pessoas, Terceirização Pessoas, Serviço SEO/GEO. |
| `products` | `service_category_id` (opcional) |
| `deals` | `service_category_id` (opcional), usado quando o negócio não tem produtos |
| `deal_items` | `service_category_id`, herdado do produto e editável no item |

Tela: **Configurações › Categorias de serviço**, por empresa, para o admin geral (como Produtos). Criar em uma linha (só o nome é obrigatório), renomear, reordenar por arrastar, mudar a cor e desativar. Uma categoria em uso não é excluída, só desativada. Os seletores de categoria (produto, negócio, item e linha de contrato) oferecem "Nova categoria…" para quem pode cadastrar.

### No Financeiro

| Tabela | Campos principais |
|---|---|
| `fin_accounts` | nome, banco, ativo. Ex.: Itaú PJ, Cartão de crédito. |
| `fin_balance_snapshots` | account_id, data, saldo, observação |
| `fin_expense_categories` | nome, natureza padrão, ordem, ativo. Seed com a coluna B da aba Despesas: Aquisição de clientes, Pró-labore, Pessoas, Comissão, Escritório/administração geral, Custo de mercadorias/custo de serviços, Viagens, Despesas jurídicas, Seguros, Tecnologia, Repasses, Impostos/taxas bancárias. |
| `fin_income_categories` | nome, ordem, ativo. Categoria das entradas avulsas (as de contrato usam a categoria de serviço). Seed com os grupos da aba Renda: Vendas, Comissão, Repasses, Investimentos/rendimentos. |
| `fin_contracts` | organization_id (cliente), deal_id de origem (único, opcional), título, status (`draft`, `active`, `ended`, `cancelled`), dia de vencimento (1–31), `retention_rate` (% retido na fonte), account_id, regra de fim (abaixo), observações |
| `fin_contract_lines` | contract_id, tipo (`setup`, `recurring`, `commission`), descrição, service_category_id, valor, `first_month`, `installments` (setup) ou `months` (recorrente e comissão). Só na comissão: `setup_rate` e `recurring_rate` (% sobre a venda) e `estimated_monthly` (comissão mensal estimada, opcional, para a projeção) |
| `fin_contract_sellers` | contract_id, user_id. Quem pode lançar vendas naquele contrato. Lista vazia = qualquer usuário com `register_sales` na empresa. |
| `fin_client_sales` | contract_id, contract_line_id (linha de comissão), cliente final (texto), data da venda, valor de setup, parcelas do setup e mês do 1º recebimento, valor recorrente mensal, mês de início e meses de recorrência, observação, `created_by` (quem cadastrou), status (`active`, `cancelled`) |
| `fin_recurring_expenses` | descrição, favorecido, expense_category_id, natureza, valor, periodicidade (`monthly`, `quarterly`, `yearly`), dia, início, fim (opcional), `installments` (opcional, para parcelamentos), reajuste (% e mês de aplicação), account_id, ativo |
| `fin_entries` | direção (`in`, `out`), origem (`contract`, `recurring`, `sale`, `manual`, `import`) e id da origem (inclui `client_sale_id`), `estimated` (comissão estimada), data de vencimento, mês de competência, valor bruto, retenção, valor líquido previsto, status (`open`, `settled`, `cancelled`), data e valor liquidados, account_id, categoria de serviço ou de receita (entradas), categoria de despesa e natureza (saídas), organização, descrição, `locked` (editado à mão) |

**Regra de fim de vigência** (`fin_contracts`):
- `end_rule`: `ends` (encerra), `auto_renew` (renova), `renew_adjust` (renova com reajuste) ou `confirm` (renovação a confirmar).
- `renewal_months`: duração de cada renovação. O padrão é a duração original.
- `adjust_kind`: `none`, `percent` (% fixo) ou `index` (IPCA, IGP-M, INPC).
- `adjust_rate`: o % usado na projeção. Para índice, o usuário informa a estimativa, porque o sistema não busca o índice. Na renovação de fato, o usuário confirma o % real.

## Regras

### Geração de lançamentos

Uma função no banco, `fin_regenerate(source)`, refaz os lançamentos `open` e não `locked` de um contrato ou despesa recorrente sempre que a origem muda. Lançamentos liquidados ou editados à mão nunca são refeitos.

- **Contrato**: cada linha gera um lançamento por mês, no dia de vencimento do contrato (ajustado ao último dia em meses curtos). O setup gera `valor / installments` por mês, com os centavos residuais na última parcela. O líquido previsto é bruto × (1 − `retention_rate`). Linhas recorrentes geram até o fim da vigência e então seguem a regra de fim:
  - `ends`: param.
  - `auto_renew` e `renew_adjust`: continuam com o novo valor (reajustado) até o horizonte.
  - `confirm`: continuam até o horizonte com a marca **renovação a confirmar**. Elas só entram na projeção quando o filtro "Incluir renovações a confirmar" está ligado.
- **Despesa recorrente**: um lançamento por período, até o fim, até o número de parcelas ou até o horizonte, aplicando o reajuste no mês configurado.
- **Impostos**: ficam digitados, como despesas recorrentes (ex.: DARF e ISS mensais com valor estimado) ou avulsas (ex.: IRPJ/CSLL trimestral), na categoria Impostos/taxas bancárias. A retenção na fonte continua no contrato, porque define o valor líquido que entra.
- **Horizonte**: o que não tem fim (renovações, despesas sem data final) é gerado até 36 meses à frente. Um job mensal do `pg_cron` estende o horizonte.

### Comissionamento

- A linha de comissão de um contrato define `setup_rate` e `recurring_rate` e a vigência (`first_month` e `months`). A regra de fim do contrato vale também para ela.
- Cada **venda do cliente** gera lançamentos de entrada da Oxyn:
  - **setup**: para cada parcela que o cliente recebe no mês M, comissão = parcela × `setup_rate`, com vencimento no mês M+1;
  - **recorrência**: para cada mês M de recebimento do cliente (do mês de início até os meses informados), comissão = valor mensal × `recurring_rate`, com vencimento no mês M+1;
  - o vencimento usa o dia de vencimento do contrato, e a retenção do contrato vale também para a comissão;
  - meses de recebimento fora da vigência da linha de comissão não geram comissão.
- Editar ou cancelar a venda refaz os lançamentos abertos e não `locked` dela, com a mesma preservação dos contratos.
- **Comissão estimada**: se a linha tem `estimated_monthly`, cada mês futuro da vigência recebe um lançamento `estimated`. Ele só entra na projeção com o filtro "Incluir comissões estimadas" ligado, e nunca soma com as comissões reais. Assim, dá para ver o cenário com e sem a expectativa.
- Mudar o % da linha refaz os lançamentos abertos de todas as vendas daquela linha.

### Tela de Vendas

- Rota `/<empresa>/vendas`, com o item "Vendas" no menu, para quem tem `register_sales` (ou `manage_finance`) numa empresa com Financeiro ativo.
- O vendedor escolhe o contrato numa lista que mostra só o nome do contrato e do cliente: os contratos ativos com linha de comissão em que ele está autorizado (`fin_contract_sellers`, ou todos se a lista estiver vazia). Depois preenche cliente final, data, setup (valor, parcelas e 1º recebimento) e recorrência (valor mensal, início e meses).
- O vendedor vê e edita só as vendas que ele cadastrou, enquanto nenhum lançamento delas foi liquidado. Ele **não vê** percentuais, comissões, lançamentos nem nenhuma outra tela do Financeiro.
- Quem tem `view_finance` vê todas as vendas, com a comissão calculada, na aba **Financeiro › Vendas**. Quem tem `manage_finance` edita, cancela e define os vendedores autorizados de cada contrato.

### Negócio ganho vira contrato

- Quando um negócio passa a `won` numa empresa com `finance_enabled`, um trigger cria um **contrato rascunho**:
  - cliente e `deal_id` vêm do negócio;
  - as linhas vêm dos `deal_items`, com a categoria de serviço de cada item;
  - sem itens, as linhas vêm de `setup_total`/`setup_installments`/`setup_first_due` e `mrr`/`mrr_start`/`contract_months`, com a categoria do negócio.
- O rascunho não gera lançamentos. Ele aparece com um selo em **Financeiro › Contratos › Pendentes** para que quem tem `manage_finance` complete o dia de vencimento, a retenção, a conta e a regra de fim e então **ative** o contrato.
- Enquanto é rascunho, editar as condições do negócio atualiza o rascunho.
- Se o negócio é reaberto ou perdido, o rascunho é excluído. Se o contrato já está ativo, nada é apagado: o contrato mostra o aviso "o negócio de origem mudou" e um link para o negócio.
- Contratos também podem ser criados à mão, para clientes anteriores ao CRM.

### Baixa

- **Liquidar** pede a data e o valor reais (preenchidos com os previstos) e a conta. A diferença entre previsto e realizado fica guardada.
- A baixa pode ser feita em lote na visão Mês.
- Um lançamento pode ser editado (fica `locked`), cancelado ou reaberto.

### Saldo

Saldo projetado de uma conta numa data D:
- parte do último saldo informado (data S);
- soma os lançamentos liquidados com data entre S (exclusive) e D;
- soma os lançamentos abertos com vencimento até D. Os vencidos e não liquidados contam como se caíssem hoje e aparecem em destaque.

O saldo total é a soma das contas ativas. Sem saldo informado, a tela pede um antes de mostrar a projeção.

## Visões

Rota `/<empresa>/financeiro`, visível só com `finance_enabled` e `view_finance`. Filtros comuns: período, cliente, categoria de serviço, categoria de despesa, natureza, conta, status, "Incluir renovações a confirmar" e "Incluir comissões estimadas". Os filtros ficam na URL.

1. **Mês** (abre por padrão): saldo atual, a receber, a pagar e saldo projetado no fim do mês. Lista dia a dia de entradas e saídas com o saldo corrido, vencidos em vermelho e baixa individual ou em lote. Navegação entre meses.
2. **Projeção**: horizonte de 3, 6, 12 (padrão), 24 ou 36 meses, a partir do mês atual. Tabela e gráfico com receita bruta, retenções, receita líquida, custos fixos, variáveis e não recorrentes, resultado e saldo projetado no fim de cada mês. Meses passados mostram previsto × realizado.
3. **Clientes**: receita no período, share % (barra e pizza), MRR atual, data de fim da vigência e regra de fim de cada cliente, com destaque para quem vence nos próximos 90 dias.
4. **Serviços**: receita e share por categoria de serviço, no período.
5. **Custos**: fixo × variável × não recorrente, por categoria e mês.
   - **Ponto de equilíbrio** = custo fixo ÷ (1 − custos variáveis ÷ receita), na média do período.
   - **Cobertura** = saldo atual ÷ custo fixo médio mensal, em meses.
6. **Lançamentos**: lista paginada com todos os filtros, criação de lançamento avulso e exportação em CSV.
7. **Contratos**: abas Pendentes, Ativos e Encerrados. O detalhe mostra as linhas, a regra de fim e os lançamentos.
8. **Despesas recorrentes**: lista, criação e edição.
9. **Vendas**: todas as vendas dos clientes, com a comissão calculada de cada uma, filtráveis por contrato, vendedor e mês.
10. **Configurações do Financeiro**: contas, categorias de despesa e categorias de receita. Cadastro em uma linha, como nas categorias de serviço, e "Nova categoria…" direto nos formulários de despesa e lançamento.

## Permissões

Três chaves novas em `roles.permissions.settings`, desligadas em todos os papéis:
- `view_finance`: vê o módulo inteiro.
- `manage_finance`: cria, edita, liquida, ativa contratos e mexe nas configurações do Financeiro.
- `register_sales`: só a tela de Vendas (cadastrar e editar as próprias vendas). Ela não dá leitura de nenhuma tabela `fin_*`. As escritas e leituras do vendedor passam por funções `security definer` que devolvem só o necessário.

O admin geral tem as três. Os dados do Financeiro não seguem a visibilidade `own`/`team`: quem tem `view_finance` vê tudo da empresa. As políticas RLS usam uma função `can_finance(company_id, action)`, que exige `finance_enabled`, membership e a chave correspondente. A geração de contrato rascunho roda em `security definer` dentro do trigger, porque quem ganha o negócio normalmente não tem acesso ao Financeiro.

## Carga inicial

Um script `pnpm import:financeiro` lê um JSON montado a partir da planilha. O módulo já é entregue com a carga feita. Onde a planilha não diz, valem os padrões: regra de fim "renovação a confirmar", conta Itaú PJ sem saldo e as categorias de serviço informadas pelo usuário para cada cliente. O script pode ser repetido sem duplicar, porque casa os registros por uma chave de origem (aba, linha e mês).

**Realizado (jan/2026 até o último mês conferido)**, como lançamentos `settled` com origem `import`:
- **Saídas** da aba Despesas: cada célula com valor vira um lançamento. A categoria é o grupo da coluna B, a natureza vem do subgrupo ("despesas fixas" → `fixed`, "despesas variáveis" → `variable`), a descrição vem da coluna G e o dia vem da coluna E (sem dia, dia 1). Linhas de obras, móveis e equipamentos ("Obras – …", "Artigo fixo – …") entram como `non_recurring`.
- **Entradas** da aba Renda: cada célula com valor vira um lançamento, com o cliente da coluna G e o dia da coluna E. As linhas de Vendas recebem a categoria de serviço do contrato correspondente; Comissão, Repasses e Investimentos recebem a categoria de receita do mesmo nome. A retenção vem das linhas "Impostos retidos na fonte" da aba Despesas, casada pelo cliente.
- O limite é a marcação "conferido até" da linha final de cada aba. Mês parcialmente conferido entra até a data marcada.

**Futuro (a partir do primeiro mês não conferido)**, como cadastros que geram lançamentos:
- contratos ativos (Omni 11, Harpix Operação/CRO/CTO/Mentoria, Naia), com valores, dias e retenções da aba Renda. A regra de fim padrão é "renovação a confirmar" e pode ser trocada depois na tela do contrato. A planilha não tem regras de comissão: as linhas de comissão são cadastradas depois, na tela do contrato;
- despesas recorrentes vigentes, deduzidas das linhas da aba Despesas que se repetem nos meses futuros (salários em duas parcelas, VR, aluguéis, contabilidade, plano de saúde, cartão, parcelamentos e impostos estimados);
- contas e saldo informado, digitados pelo usuário.

Os valores futuros digitados na planilha (nov–dez) não são importados como lançamentos. Eles servem para conferir que os cadastros geram a mesma projeção, e o script mostra as diferenças por mês.

## Erros

- Ativar um contrato sem dia de vencimento, conta ou regra de fim falha com a lista do que falta.
- Excluir uma conta, categoria ou contrato com lançamentos liquidados não é permitido. Eles são desativados ou encerrados.
- A regeneração roda numa transação. Se falhar, a origem não é salva.

## Testes

- **pgTAP**: `can_finance` × papéis × `finance_enabled`; o trigger de ganho cria o rascunho, atualiza enquanto é rascunho e não apaga um contrato ativo; a geração de lançamentos por regra de fim, setup parcelado, reajuste e parcelamento; lançamentos liquidados e `locked` sobrevivem à regeneração.
- **Vitest**: cálculo do saldo projetado, ponto de equilíbrio, cobertura e share.
- **Playwright**: ganhar um negócio, ativar o contrato e ver a projeção mudar; liquidar em lote na visão Mês; um usuário sem `view_finance` não vê o menu nem acessa a rota.

## Ordem de entrega

1. Categorias de serviço no CRM (tabela, Configurações, produtos, negócios e itens).
2. Base do Financeiro: `finance_enabled`, permissões, contas, saldo informado, categorias de despesa e de receita.
3. Contratos, geração de lançamentos e negócio ganho → rascunho.
4. Despesas recorrentes e lançamentos avulsos.
5. Visões Mês e Lançamentos, com baixa.
6. Visões Projeção, Clientes, Serviços e Custos.
7. Carga inicial a partir da planilha.
8. Comissionamento: linha de comissão, vendas do cliente e tela de Vendas.

## Depois desta versão

- Regras de imposto: % sobre a receita bruta prevista, mensal ou trimestral, gerando as saídas sozinhas.
- Importação e conciliação de extrato.
