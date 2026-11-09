# Importar e-mails e arquivos do Pipedrive

Data: 2026-11-09. Parte 1 de 3 da preparação para desligar o Pipedrive. As outras partes estão em `2026-11-09-agenda-google-design.md` e `2026-11-09-reunioes-no-crm-design.md`.

## Objetivo

A importação atual traz empresas, pessoas, leads, negócios, atividades, anotações e produtos. Ela não traz os e-mails guardados no Pipedrive nem os arquivos anexados. O Gmail do CRM só busca 90 dias para trás. Sem esta parte, o histórico de e-mails e os arquivos se perdem quando a assinatura do Pipedrive for cancelada.

**Sucesso:** no card de cada pessoa, organização e negócio, o vendedor vê os e-mails que estavam no Pipedrive e abre os anexos e os arquivos do card, sem o Pipedrive.

## Volume medido (2026-11-09, só leitura)

| Item | Quantidade |
|---|---|
| E-mails ligados a pessoas | 9.413 mensagens, em 2.133 pessoas |
| E-mails ligados a organizações | 9.360 mensagens, em 1.609 organizações (a maioria é a mesma mensagem ligada à pessoa) |
| E-mails ligados a negócios | 554 mensagens, em 27 negócios |
| Arquivos | 13.278 (2,4 GB). 10.619 vêm de e-mails: 8.637 imagens, quase todas de assinatura, e 1.501 convites `.ics` |
| Arquivos anexados direto em cards | cerca de 140, em negócios, pessoas, organizações, leads e atividades |
| Arquivos que são links | 489, guardados fora do Pipedrive (`remote_location` diferente de `s3`) |

O token de API lê os e-mails de todos os vendedores, com o corpo inteiro (`mailbox/mailMessages/{id}?include_body=1`).

## Decisões

| Tema | Decisão |
|---|---|
| Anexos de e-mail | **Só anexos reais** (decisão do usuário): os arquivos com `inline_flag` (imagens dentro do corpo, como assinaturas) e os convites `.ics` ficam de fora. Os demais entram, inclusive imagens anexadas de verdade. |
| Arquivos dos cards | Entram todos. Arquivos que são links entram só como link. |
| Onde guardar os e-mails | Tabelas próprias (`pipedrive_emails` e `pipedrive_email_links`), separadas das tabelas do Gmail. As do Gmail exigem uma caixa conectada (`account_id`), e os e-mails importados não têm. Separar também evita mexer na sincronização do Gmail, que está no ar. |
| Onde guardar os arquivos | Supabase Storage, num bucket privado `record-files`. O download usa uma URL assinada de curta duração, gerada depois de conferir o acesso. |
| Quem vê | Quem pode ver o registro vinculado, como os e-mails do Gmail no CRM. Há uma exceção: se o vendedor dono do e-mail no Pipedrive tem a caixa marcada como privada no CRM, só ele e o admin geral veem. |
| Como roda | Um script reexecutável, `pnpm import:pipedrive-arquivos`. Ele roda agora e de novo no dia da virada, para trazer o que chegou nesse meio-tempo. É idempotente pelo id do Pipedrive e fica fora da rotina diária, porque a primeira carga é longa. |
| Duplicados com o Gmail | O mesmo e-mail pode estar no Pipedrive e no Gmail do CRM (últimos 90 dias). No card, o importado do Pipedrive é escondido quando já existe um e-mail do Gmail com o mesmo `Message-ID` (`mua_message_id` do Pipedrive igual a `email_messages.rfc_message_id`). |
| Responder | E-mail importado não tem botão de responder: é histórico. Para responder, o vendedor usa a conversa do Gmail. |

## Modelo de dados

| Tabela | Campos |
|---|---|
| `pipedrive_emails` | id, company_id, pipedrive_id (id da mensagem), pipedrive_thread_id, owner_id → profiles (vendedor dono no Pipedrive, pelo mapa de usuários da importação; nulo se não mapeado), subject, from_email, from_name, to jsonb, cc jsonb, sent_at, snippet, body_html (até 1 MB), rfc_message_id, direction (`in`/`out`, pelo endereço do dono), attachments jsonb (`{file_id, filename, size, mime}`), imported_at. Único `(company_id, pipedrive_id)`. |
| `pipedrive_email_links` | email_id (cascade), entity (`deals`, `leads`, `persons`, `organizations`), record_id. Único `(email_id, entity, record_id)`. |
| `record_files` | id, company_id, entity, record_id, pipedrive_id (id do arquivo), filename, mime, size, storage_path (nulo quando é link), remote_url (link externo), email_id (nulo quando é arquivo do card), created_by, created_at, deleted_at. Único `(company_id, pipedrive_id)`. |

**Regras das tabelas:**
- O e-mail fica numa linha por empresa. Uma pessoa que existe em duas empresas do CRM tem o e-mail nas duas, cada uma com os seus vínculos, seguindo o `external_ids` (um registro por empresa).
- **RLS:** só leitura para `authenticated`, por uma função `can_read_pipedrive_email(email_id)`. Ela é `security definer` e libera quando o usuário é o dono, ou quando a regra de "quem vê" acima vale e `can_read_record` é verdadeiro em algum vínculo. `record_files` segue `can_read_record` do registro (ou do e-mail, para anexos).
- **Escrita:** só o service role (o script).
- **Modo espelho:** a limpeza do modo espelho (`import_mirror_prune`) não mexe nessas tabelas. Um vínculo com registro na lixeira continua, e o e-mail some do card junto com o registro.

## Fluxo da importação

1. Lê o último job de importação concluído, para obter o mapa de usuários e empresas (`mappings`) e o `external_ids`.
2. **E-mails:** percorre os negócios, pessoas e organizações com `email_messages_count > 0` e chama `/{entidade}/{id}/mailMessages`, com paginação. Cada mensagem vira uma linha por empresa em que o registro existe, com vínculo ao registro. A mesma mensagem vista por outro registro só ganha mais um vínculo.
3. **Corpo:** busca o corpo de cada mensagem nova (`include_body=1`) e corta em 1 MB.
4. **Arquivos:** percorre `/v1/files` (sem os apagados).
   - Arquivo de e-mail: entra só se a mensagem foi importada, não é `inline` e não é `.ics`. É ligado ao e-mail.
   - Arquivo de card (`deal_id`, `person_id`, `org_id`, `lead_id` ou `activity_id`): é ligado ao registro. O de atividade vai para o registro vinculado à atividade.
   - Download por `/v1/files/{id}/download` e envio ao bucket, em `record-files/{company_id}/pd-{id do arquivo no Pipedrive}/{nome ASCII seguro}` (sem acentos, só `[A-Za-z0-9._-]`, até 120 caracteres com a extensão, `arquivo` se ficar vazio). O nome original fica em `record_files.filename`.
   - Link externo: só `remote_url`.
5. **Retomada:** cada etapa é idempotente. Mensagem ou arquivo já importado é pulado pelo id. Uma falha num item vai para o relatório e não para o resto.
6. **Relatório no fim:** e-mails novos e já existentes, vínculos, arquivos enviados, links, pulados (inline e `.ics`) e erros.

O cliente HTTP reaproveita o `createPipedriveClient` da importação, que já trata o 429 do Pipedrive e as falhas de rede com novas tentativas.

## Interface

- **Card (pessoa, organização, negócio, lead):** os e-mails importados aparecem no histórico, na categoria E-mail, como uma conversa com o selo "Importado do Pipedrive".
  - Mesmo visual do cartão de conversa do Gmail. Os e-mails da mesma conversa do Pipedrive (`pipedrive_thread_id`) ficam juntos.
  - O corpo carrega ao abrir, como no Gmail.
  - Os anexos viram links de download.
- **Seção "Arquivos" no card:** lista os arquivos do registro (nome, tamanho, data), com download e, para os links, abrir em nova aba.
- **Download:** uma server action confere o acesso e devolve uma URL assinada de 60 segundos.

Fica para depois: enviar arquivos novos para um card. A importação não depende disso.

## Erros

| Situação | Comportamento |
|---|---|
| Registro do Pipedrive sem correspondente no CRM | Pula o vínculo e conta no relatório. Se a mensagem ficar sem nenhum vínculo, ela não é gravada. |
| Arquivo maior que o limite do bucket (25 MB) | Grava só o nome e conta no relatório. |
| Falha de download ou de envio | Erro no relatório. Rodar de novo tenta outra vez. |
| Token do Pipedrive inválido | O script para com a mensagem de erro. |

## Testes

- **Mapeamento (Vitest):**
  - mensagem do Pipedrive para linha de `pipedrive_emails`: direção, corpo cortado, anexos;
  - filtro de anexos reais;
  - resolução de vínculos por empresa.
- **Script com Pipedrive simulado e banco falso:**
  - idempotência: rodar duas vezes não duplica;
  - mensagem vista por dois registros vira um e-mail com dois vínculos;
  - arquivo de card e arquivo de e-mail;
  - link externo;
  - falha de um item não para o resto.
- **Duplicados com o Gmail:** o e-mail importado some quando já existe o do Gmail com o mesmo `Message-ID`.
- **RLS:** função de leitura com vendedor dono, caixa privada e registro sem acesso.
