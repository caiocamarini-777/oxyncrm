# Fase 2: pendências e decisões

Registro gerado ao fim da execução da fase 2 (branch `feat/fase-2-contatos-leads`): Contatos, Leads, anotações, linha do tempo, busca global e lixeira.

## Ações manuais

- Antes do merge, o banco de dev deve ser resetado para refletir as migrations da fase 2 como estão nos arquivos. Elas foram editadas no lugar durante a fase (permitido enquanto não havia produção) e as mudanças foram reaplicadas no dev à mão, então pode haver diferença entre o dev e os arquivos.
- Em produção, as migrations 0001 a 0005 da fase 1 e as da fase 2 (`20261022000001` a `20261022000005`) devem ser aplicadas do zero, nessa ordem, e `pnpm test:db` deve rodar no banco novo. A partir do merge, migrations passam a ser imutáveis: mudanças só em arquivos novos.
- Conferir no banco de produção que o `pg_cron` está habilitado, para a limpeza diária da lixeira (`purge_trash()`, 30 dias).

## Decisões

- O ambiente da fase 1 continua valendo: banco Supabase hospedado de dev, `pnpm db:migrate` e `pnpm test:db`, e-mails enviados pelo app, fixtures com prefixo `tst-`, limpeza dos E2E e gate de CI.
- As migrations da fase 2 podem ser editadas no lugar enquanto não houver merge, reaplicando as mudanças no dev. Custo se errado: divergência no dev, recuperável.
- A fase 2 liga Leads e Contatos na navegação (`CURRENT_PHASE = 2`). O link de Leads ficou habilitado antes da tela existir, dentro do branch, sem efeito fora dele.
- `guard_same_company` virou `security definer`: só compara ids de empresa e não devolve dados, para que o RLS por responsável não faça referências válidas falharem.
- `record_ref` não é concedida ao `authenticated` (nenhum metadado entre empresas). Quem a chama são funções `security definer`.
- Reatribuir responsável passa pela função `reassign_record(entity, id, owner)`, porque um UPDATE comum falha quando o novo responsável está fora da visão de quem altera.
- Sondagem por `owner_has_membership` e `validate_custom_fields`, inserção de registro já na lixeira e `created_by` forjado foram fechados na rodada de correção da tarefa 2.
- O teste de fase 1 "admin vê tst-volt e tst-naia" foi reescrito para filtrar por ids de fixture, evitando flakiness com E2E em paralelo.
- A organização na ficha da pessoa usa `organization_label` devolvendo nome e estado de lixeira, e só para empresas a que o usuário tem acesso.
- Heurística de WhatsApp (rótulo Celular ou 11 dígitos com 9 depois do DDD) mantida.
- Telefones são normalizados para a forma nacional (sem +55) no trigger `normalize_person_contacts`, espelhado em `normalizePhone`. Pessoas têm `search_text` mantido por trigger (nome, cargo, e-mails, dígitos do telefone) com índice trigrama, usado na busca da lista.
- Os helpers copiados entre organizações e pessoas foram extraídos para `src/lib/records/list-helpers.ts`, `action-helpers.ts` e `export-link.tsx`.
- Criação rápida de lead que cria pessoa ou organização e falha ao inserir o lead deixa o contato criado, com aviso no erro (não há exclusão definitiva para usuários comuns).
- As ações (incluindo excluir) são por papel e empresa, não por entidade, porque o JSON de permissões não tem ações por entidade. A lixeira lê a permissão uma vez.
- Converter lead em negócio fica para a fase 3.

## Melhorias adiadas

Banco e segurança:
- O CHECK não valida o formato dos elementos de `options` e `emails`; `to_jsonb(new)` é calculado sem necessidade; `search_path` sem `pg_temp`; faltam testes dos ramos entre empresas de `notes` e `record_labels`.
- O teste de soft-delete de anotações só confere `lives_ok`; `reassign_record` não tem testes de registro na lixeira nem entre empresas.
- Consultas por e-mail não usam GIN em jsonb; não há limite de e-mails por verificação de duplicidade; as buscas por CNPJ e domínio usam `ilike` sem índice.
- A limpeza da lixeira cria eventos `updated` sem autor em registros vinculados vivos (a tela mostra "Sistema"); o `note_id` de uma anotação já apagada pode ficar pendurado (a tela tolera); a contagem de purga não inclui anotações em cascata.
- `purgeRecord` não exige `deleted_at` preenchido (só o admin geral executa).
- Transições de status do lead só são garantidas no app; guarda no banco virá com negócios.

Campos e etiquetas:
- `validDate` rejeita anos abaixo de 100; remover uma opção de seleção deixa valores órfãos nos registros; as ações de atualização não conferem linhas afetadas.

Listas e filtros:
- Links de paginação desabilitados continuam focáveis; o debounce dos filtros pode usar parâmetros antigos; não há validação de data inicial menor que final; `listCompaniesWithCreate` é sequencial; interpolação em `.or()` na lista de responsáveis.
- O filtro por etiqueta com `.in(ids)` não escala (precisa de RPC ou view); a exportação tem teto silencioso de 50 mil linhas e repete contagem e etiquetas por lote.
- Página além do fim devolve total 0.
- Busca parcial "+55 11 9999" não encontra nada; `_` não é escapado em `ilike`.
- Valor "1.500,25" (com separador de milhar) é rejeitado no lead.

Telas:
- O formulário de edição mantém valores não normalizados até remontar; acessibilidade (aria-describedby, foco das abas); coluna "Pessoas" versus "Pessoas vinculadas"; `Object.hasOwn` em `EXPORT_SEGMENTS`; `RecordNoun.singular` sem uso.
- Anotações: o `linkify` remove parênteses finais legítimos; o rascunho do `NoteCard` pode ficar defasado; Ctrl+Enter ignora composição de IME; anotações fora da janela de 500 eventos somem da linha do tempo; falta marca "editada"; a exclusão usa `window.confirm`.
- Lead: a criação rápida cria pessoa ou organização antes de validar a permissão de criar lead e a origem (órfãos evitáveis); vincular pessoa ou organização da mesma empresa que o usuário não lê, via UUID forjado; mensagem de erro de transição com 0 linhas é enganosa; `searchPersonsByName` duplica `safeTerm`.
- Busca global e lixeira: o `CommandEmpty` pisca durante a busca; o valor do item da paleta muda a cada tecla; um teste de busca na lixeira pode passar durante o debounce.

Testes:
- Lacunas de E2E: exportação com filtros e na visão Todas, salvar com aviso de duplicidade e a marca "(inativa)" no formulário de edição do lead.
