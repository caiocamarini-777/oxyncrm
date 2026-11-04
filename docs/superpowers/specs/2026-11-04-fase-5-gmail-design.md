# Fase 5: Gmail no Oxyn CRM

Data: 2026-11-04. Detalha a seção "Fase 5: Gmail" da spec geral (`2026-10-21-oxyn-crm-design.md`) com as decisões tomadas com o usuário.

## Objetivo

Cada vendedor conecta a própria caixa Google Workspace. Os e-mails trocados com contatos do CRM aparecem sozinhos no card da pessoa, da organização e dos leads e negócios abertos dela. Também é possível vincular uma conversa à mão e enviar ou responder e-mails pelo CRM.

## Decisões do usuário (2026-11-04)

| Tema | Decisão |
|---|---|
| Quem conecta | Oxyn e outros domínios. O app Google é do tipo **Externo**, e o admin do Workspace de cada domínio marca o app como confiável. |
| Empresa | **Uma empresa por caixa.** Ao conectar, o usuário escolhe a empresa, que precisa ser uma das dele. |
| Escopo | Ler, vincular (automático e manual), **enviar e responder** com modelos. |
| Visibilidade | Padrão **compartilhado**: quem vê o card vê os e-mails dele. O dono pode marcar a caixa como privada. |

## Decisões técnicas (minhas, registradas)

- **Sem Edge Functions.** O código roda em route handlers do Next na Vercel, como o cron de lembretes. A sincronização é um cron da Vercel em `/api/cron/gmail` a cada 5 minutos (`maxDuration` 300 no Pro).
- **Sem dependência `googleapis`.** Um cliente REST pequeno com `fetch` cobre OAuth, `users.getProfile`, `messages.list/get`, `history.list`, `threads.list/get` e `messages.send`.
- **Tokens criptografados na aplicação** com AES-256-GCM e a chave `GMAIL_TOKEN_KEY`. Ficam numa tabela à parte (`email_account_secrets`), com RLS ligado e sem policies, de modo que só o service role lê. Isso troca o Supabase Vault da spec geral: o resultado é o mesmo (o token nunca chega ao navegador) e o código fica testável sem banco.
- **Primeira carga de 12 meses** em vez de 90 dias. Substitui a importação de e-mails do Pipedrive, que só enxergaria a caixa do dono do token.
- **HTML do e-mail exibido num `iframe` sandbox** (sem `allow-scripts`, com CSP `default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:`). Isso substitui o "HTML sanitizado" da spec geral sem trazer biblioteca nova. O corpo é guardado como veio, limitado a 512 KB; acima disso, guarda só o texto.
- **Escopos OAuth:** `openid`, `email`, `https://www.googleapis.com/auth/gmail.readonly` e `https://www.googleapis.com/auth/gmail.send`, com `access_type=offline` e `prompt=consent`.

## Modelo de dados

| Tabela | Campos |
|---|---|
| `email_accounts` | id, user_id → profiles, company_id → companies, email (único global, minúsculo), status (`active`, `reconnect`), visibility (`shared`, `private`), history_id text, backfill_page_token text, backfill_done bool, last_synced_at, last_error, created_at |
| `email_account_secrets` | account_id (pk, cascade), refresh_token_enc, access_token_enc, access_expires_at |
| `email_threads` | id, account_id (cascade), company_id, gmail_thread_id, subject, last_message_at; único (account_id, gmail_thread_id) |
| `email_messages` | id, thread_id (cascade), account_id, gmail_message_id, rfc_message_id, from_email, from_name, to jsonb, cc jsonb (lista de `{email, name}`), sent_at, snippet, body_html, body_text, attachments jsonb (`{filename, mimeType, size}`), direction (`in`, `out`); único (account_id, gmail_message_id) |
| `email_links` | id, thread_id (cascade), entity (`leads`, `deals`, `persons`, `organizations`), record_id, origin (`auto`, `manual`), linked_by, created_at, unlinked_at, unlinked_by; único (thread_id, entity, record_id) |
| `email_templates` | id, company_id, name, subject, body (texto com variáveis), created_by, created_at, updated_at, deleted_at |
| `companies.settings.email_sent_as_activity` | bool no JSON existente, padrão false |

### RLS

- `email_accounts`: o dono lê, muda a visibilidade e apaga. O admin geral lê tudo. Só o service role insere (callback OAuth).
- `email_account_secrets`: RLS sem policy (só o service role).
- Função `can_read_email_thread(thread_id)` (security definer). Devolve verdadeiro se o usuário é o dono da caixa, ou se a caixa é `shared` e existe vínculo ativo (sem `unlinked_at`) para um registro que `can_read_record` libera.
- `email_threads` e `email_messages`: leitura por `can_read_email_thread`. Só o service role escreve.
- `email_links`: leitura por `can_read_email_thread` e `can_read_record`. A escrita passa por funções RPC security definer: `email_link_thread(thread, entity, record)` exige ser dono da caixa e `can_edit_record`; `email_unlink_thread(link)` exige ser dono da caixa ou `can_edit_record`.
- `email_templates`: leitura para membros da empresa (`has_company_access`), escrita para `can_manage_company_lists`.

## Fluxos

### Conectar

1. Em `/perfil`, seção "E-mail", o usuário clica em "Conectar Gmail" e escolhe a empresa.
2. `GET /api/google/conectar?empresa=<id>` confere que a pessoa tem acesso à empresa, grava um cookie httpOnly com `state` aleatório e a empresa, e redireciona para o Google.
3. `GET /api/google/callback` confere o `state`, troca o code por tokens e lê o e-mail com `users.getProfile`.
   - Se a caixa já está ligada a outra pessoa, recusa.
   - Se é do próprio usuário, atualiza os tokens e volta o status para `active`.
   - Senão, cria a conta e os segredos.
   - Volta para `/perfil?gmail=ok` (ou `?gmail=erro&motivo=...`).
4. Desconectar revoga o token no Google (melhor esforço) e apaga a conta. A cascata apaga as conversas salvas daquela caixa.

### Sincronizar (cron a cada 5 min)

- **Ordem e orçamento:** contas `active`, das sincronizadas há mais tempo para as mais recentes. Orçamento de 240 s por execução, com no máximo 8 chamadas simultâneas ao Gmail.
- **Token:** o access token é renovado quando falta menos de 1 min para expirar. `invalid_grant` muda a conta para `reconnect` e grava `last_error`.
- **Primeira carga** (`backfill_done = false`):
  - No primeiro passo, grava `history_id` de `getProfile`.
  - Pagina `messages.list` com `q = "after:<hoje-12 meses> -in:chats -in:spam -in:trash"`, guardando `backfill_page_token` a cada página.
  - Cada mensagem passa pelo processamento abaixo. Ao acabar as páginas, marca `backfill_done`.
- **Incremental:** `history.list(startHistoryId, historyTypes=messageAdded)` paginado, e no fim atualiza `history_id`. Com 404 (histórico expirado), volta a primeira carga para os últimos 7 dias.
- **Processar uma mensagem:**
  1. Lê com `format=metadata` (From, To, Cc, Subject, Date, Message-ID).
  2. Calcula os vínculos com o casador.
  3. Se há vínculo, ou se a conversa já está salva, busca `format=full` e grava a conversa, a mensagem e os vínculos automáticos. O upsert é idempotente pelas chaves únicas.
  4. Vínculo desfeito à mão (`unlinked_at`) não é recriado.

### Casador (função pura)

Recebe os endereços da mensagem (menos o da própria caixa), os contatos da empresa da caixa e devolve os vínculos:

- Pessoa cujo `emails[].value` (minúsculo) bate com um endereço gera vínculo com ela, com a organização dela e com os leads (`status = open`) e negócios (`status = open`) dela ou da organização.
- Organização cujo `domain` bate com o domínio de um endereço gera vínculo com ela e com os leads e negócios abertos dela. Domínios genéricos nunca casam: gmail.com, googlemail.com, hotmail.com, outlook.com, live.com, yahoo.com, yahoo.com.br, icloud.com, me.com, uol.com.br, bol.com.br, terra.com.br, ig.com.br, msn.com, protonmail.com. O domínio da própria caixa também não casa.
- Registros apagados (`deleted_at`) não entram.
- Para não consultar o banco a cada mensagem, um índice da empresa (e-mails das pessoas e domínios das organizações) é carregado uma vez por conta a cada execução.

### Ver no card

- A aba **E-mail** dos cards de lead, negócio, pessoa e organização (hoje desativada) lista as conversas vinculadas: assunto, participantes, data e trecho, da mais recente para a mais antiga.
- Abrir uma conversa mostra as mensagens com o HTML no iframe sandbox e a lista de anexos (só os nomes).
- A aba também tem "Desvincular", "Responder" e "Novo e-mail".
- A linha do tempo ganha um item "E-mail enviado/recebido: assunto" por mensagem, respeitando a RLS.

### Módulo E-mail (`/[empresa]/email`)

- Mostra as caixas do usuário daquela empresa. Sem caixa, mostra o convite para conectar.
- A lista é lida ao vivo do Gmail (`threads.list`, 25 por página, busca com sintaxe do Gmail) e não é guardada.
- Abrir uma conversa a lê ao vivo e mostra "Vincular a…" (busca leads, negócios, pessoas e organizações da empresa). Vincular grava a conversa inteira e o vínculo manual, e as respostas futuras entram pelo processamento normal porque a conversa já está salva.
- Se o remetente não é contato, aparece "Criar pessoa" com nome e e-mail pré-preenchidos.
- A caixa com status `reconnect` mostra um aviso com o botão "Reconectar".

### Enviar e responder

- O compositor tem os campos para, cc, assunto e corpo (texto simples, que vira HTML com quebras de linha), mais a escolha de modelo.
  - Os modelos aceitam `{{pessoa.nome}}`, `{{pessoa.primeiro_nome}}`, `{{organizacao.nome}}`, `{{negocio.titulo}}`, `{{usuario.nome}}`. Variável sem valor fica vazia.
- O envio usa `messages.send` com MIME montado à mão: UTF-8, assunto em RFC 2047, `multipart/alternative` com texto e HTML. A resposta leva `threadId`, `In-Reply-To` e `References`.
- Depois de enviar, a mensagem é gravada (`direction = out`). Quando o envio partiu de um card, cria o vínculo manual com ele.
- Se `email_sent_as_activity` está ligado, cria também uma atividade concluída do tipo E-mail no canal E-mail, ligada ao card. O tipo e o canal são buscados pelo nome na empresa; se não existirem, a atividade não é criada.

### Configurações

- **`/perfil` → E-mail:** conectar, listar caixas (endereço, empresa, status, última sincronização), visibilidade e desconectar.
- **Configurações → Modelos de e-mail:** criar, editar e excluir modelos da empresa, e o interruptor "E-mail enviado conta como atividade".
- **Menu lateral:** o item E-mail fica ativo (fase 5 em `DELIVERED_PHASES`).

## Variáveis de ambiente

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GMAIL_TOKEN_KEY` (32 bytes em base64). O redirect é `${NEXT_PUBLIC_SITE_URL}/api/google/callback`. Sem essas variáveis, a seção E-mail mostra "Integração com o Gmail ainda não configurada" e o cron não faz nada.

## Configuração no Google (passo a passo para o usuário)

1. No Google Cloud Console, em um projeto da Oxyn, ativar a **Gmail API**.
2. Na tela de consentimento OAuth, escolher o tipo **Externo**:
   - nome "Oxyn CRM", e-mail de suporte e domínio `oxyngroup.com.br`;
   - escopos `gmail.readonly` e `gmail.send`;
   - status **Em produção**, porque em "Teste" o token expira em 7 dias.
3. Em Credenciais, criar um **ID do cliente OAuth** do tipo Aplicativo da Web, com o redirect `https://crm.oxyngroup.com.br/api/google/callback` (e `http://localhost:3001/api/google/callback` para testar local).
4. Na Vercel, cadastrar `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`. Eu gero e cadastro `GMAIL_TOKEN_KEY`.
5. Em cada Workspace (Oxyn, Harpix...), o admin abre Admin Console → Segurança → Controles de API → Acesso a apps de terceiros, procura o app pelo ID do cliente e marca **Confiável**. Assim os usuários do domínio não veem o aviso de app não verificado nem esbarram na verificação dos escopos restritos.

## Erros

- **Token revogado:** a caixa fica com status `reconnect`, com aviso em `/perfil` e no módulo E-mail.
- **Limite do Gmail (429/403 rateLimitExceeded):** a conta para nesta execução e retoma na próxima.
- **Falha em uma mensagem:** registra o erro e segue. A mensagem volta na próxima carga, porque o `history_id` só avança ao fim do lote.
- **Cron:** responde com contadores por conta (`processed`, `stored`, `linked`, `errors`).

## Testes

- Unitários (vitest):
  - criptografia (ida e volta, chave errada falha);
  - MIME (assunto UTF-8, resposta com cabeçalhos);
  - parser da mensagem do Gmail (base64url, multipart aninhado, anexos);
  - casador (pessoa, domínio, domínio genérico, própria caixa, apagados, leads e negócios fechados ignorados);
  - modelos (variáveis);
  - URL de autorização e validação do `state`.
- pgTAP: RLS de `email_threads` e `email_links` (dono, compartilhado com quem vê o registro, privado, vínculo desfeito) e das RPCs de vínculo.
- Navegador: aba E-mail desativada vira ativa e a seção do perfil aparece com o aviso de "não configurado" enquanto faltam as chaves.

## Fora do escopo

- Push pelo Pub/Sub.
- Rastreio de abertura.
- Anexos para download e envio de anexos.
- Agendamento de envio.
- Caixas de outros provedores.
