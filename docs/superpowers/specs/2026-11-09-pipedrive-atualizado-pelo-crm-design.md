# Pipedrive atualizado pelo CRM durante o piloto

Data: 2026-11-09. Parte 4 da preparação para desligar o Pipedrive (as outras: `2026-11-09-importar-emails-arquivos-pipedrive-design.md`, `2026-11-09-agenda-google-design.md`, `2026-11-09-reunioes-no-crm-design.md`).

## Objetivo

Na virada, o CRM passa a ser a fonte da verdade e a equipe para de usar o Pipedrive. O usuário quer pilotar por 15 dias com o Pipedrive de backup, atualizado pelo CRM. Se algo der errado, dá para voltar ao Pipedrive sem perder o que foi feito no CRM nesse período.

**Sucesso:** durante o piloto, o Pipedrive mostra os mesmos registros do CRM, com no máximo 1 hora de atraso. Inclui o que foi criado, mudado e apagado no CRM.

## Decisões do usuário (2026-11-09)

| Tema | Decisão |
|---|---|
| Sentido | Só **CRM → Pipedrive**. A equipe usa o CRM. No Pipedrive só consulta: edição feita lá é sobrescrita na rodada seguinte. |
| Frequência | **A cada hora.** |
| Exclusões | **Apagar também.** O que for apagado no CRM (lixeira) é apagado no Pipedrive. |
| Duração | Piloto de cerca de 15 dias. Depois a rotina é desligada e o Pipedrive, cancelado. |

## Decisões técnicas (minhas)

### O que vai e o que não vai

Vai para o Pipedrive o que ele tem campo para receber:

| Registro | Campos |
|---|---|
| Organizações | nome, endereço, dono, etiqueta |
| Pessoas | nome, e-mails, telefones, organização, dono |
| Leads | título, pessoa, organização, dono, valor, etiqueta (a etiqueta de lead da empresa) |
| Negócios | título, valor, moeda, pessoa, organização, dono, funil e etapa, status (aberto, ganho ou perdido, com o motivo), data prevista de fechamento, campos personalizados mapeados |
| Atividades | tipo, assunto, descrição, data, hora, duração, vínculos, dono, concluída e o resultado da reunião (campo `outcome`) |
| Anotações | conteúdo e vínculo |

Não vai: o que só o CRM tem (contrato, cronograma de receita, canal das atividades, metas, painéis), produtos do negócio, e-mails e arquivos.

### Como os ids se correspondem

- `external_ids` já liga cada registro importado ao id dele no Pipedrive.
- **Criado no CRM:** é criado no Pipedrive, e o vínculo é gravado em `external_ids`, por uma função `security definer` nova só para o service role.
- **Mapas ao contrário:** os de usuários, funis e etapas, etiquetas de lead e campos personalizados vêm do último job de importação (`import_jobs.mappings` e `cursor.cache`), lidos na direção inversa.
- **Dono sem usuário no Pipedrive:** o registro fica com o usuário do token.
- **Um registro do Pipedrive importado em mais de uma empresa:** vale a versão mudada por último no CRM.

### Quando e como roda

- Workflow do GitHub Actions `pipedrive-backup.yml`, de hora em hora (`0 * * * *`), no ambiente `producao` (o mesmo da rotina de hoje).
- Roda o script `pnpm sync:crm-para-pipedrive`. Ele não roda na Vercel, porque uma rodada grande passa do limite de tempo das funções.

### O que cada rodada envia

- **O que mudou:** os registros com `updated_at` depois do cursor da última rodada completa, na ordem organizações → pessoas → leads → negócios → atividades → anotações, por causa das dependências.
- **Exclusões:** o que foi para a lixeira depois do cursor (`deleted_at`) é apagado no Pipedrive, na ordem inversa. Registro restaurado da lixeira volta a ser criado no Pipedrive e é religado.
- **Falhas:** o erro de um registro não para a rodada. O registro vai para a tabela `pipedrive_push_retry` e é tentado de novo nas rodadas seguintes, até 5 vezes. Depois fica no relatório. O cursor avança para o início da rodada.

### Trava e liga/desliga

- **Trava:** a rotina se recusa a rodar com o modo espelho ativo (o último job de importação é espelho e terminou há menos de 48 h). Ida e volta ao mesmo tempo apagariam dados.
- **Ligar e desligar:**
  - **O que liga:** uma configuração geral (`app_settings.pipedrive_backup_enabled`, ou uma linha numa tabela de configuração), e não uma variável no workflow.
  - **Quem mexe:** o controlador liga no dia da virada e desliga no fim do piloto, sempre com o ok do usuário.
  - **Cursor ao ligar:** começa no momento em que foi ligado. Antes disso, o Pipedrive já está igual ao CRM pela última sincronização do espelho.

### Relatório

Cada rodada grava em `pipedrive_push_runs`: início, fim, cursor, contadores por tipo (criados, atualizados, apagados, erros) e os erros. Um resumo sai no log do Actions.

## Modelo de dados

| Tabela | Campos |
|---|---|
| `pipedrive_push_runs` | id, started_at, finished_at, cursor_from, cursor_to, status (`running`, `done`, `failed`), counters jsonb, errors jsonb (até 500) |
| `pipedrive_push_retry` | entity, record_id, company_id, attempts, last_error, updated_at. Chave: `(entity, record_id)` |
| `pipedrive_push_settings` | id = 1 (uma linha só), enabled, enabled_at |

As tabelas são lidas e escritas só pelo service role. Elas não aparecem para os usuários.

## Erros

| Situação | Comportamento |
|---|---|
| Token do Pipedrive inválido | A rodada para com o erro e marca `failed`. O cursor não avança. |
| Limite de uso (429) | O cliente já espera e tenta de novo. Se a rodada estourar o tempo, para e retoma na próxima. |
| Registro relacionado sem id no Pipedrive (por exemplo, a pessoa do negócio falhou) | O negócio vai para a fila de retry. A pessoa é tentada antes na próxima rodada. |
| Etapa ou funil sem correspondente no Pipedrive (criado no CRM durante o piloto) | Erro do registro, no relatório. Funil e etapa novos no CRM durante o piloto precisam ser criados também no Pipedrive (consta no roteiro). |
| Modo espelho ativo | A rodada não roda e o motivo fica no log. |

## Roteiro do piloto

O roteiro completo do dia vai em `docs/virada-pipedrive.md`, junto com as outras partes.

1. **Dia da virada:**
   - última sincronização com o espelho;
   - desligar a rotina diária;
   - ligar a atualização do Pipedrive pelo CRM;
   - deixar os usuários do Pipedrive só com leitura, se o plano permitir.
2. **Dias 1 a 15:** a equipe trabalha só no CRM, e o Pipedrive acompanha de hora em hora. Eu confiro os relatórios das rodadas.
3. **Fim do piloto:**
   - desligar a rotina;
   - exportação completa do Pipedrive;
   - cancelar a assinatura.

## Testes

- **Conversão CRM → Pipedrive, por tipo de registro:**
  - campos, vínculos e dono;
  - etapa pelo mapa;
  - status ganho ou perdido com o motivo;
  - campos personalizados;
  - resultado da reunião.
- **Rodada com o Pipedrive simulado e o banco falso:**
  - cria o que é novo e grava o vínculo;
  - atualiza o que mudou;
  - apaga o que foi para a lixeira;
  - respeita a ordem de dependência;
  - manda a falha de um registro para a fila de retry e tenta de novo depois;
  - avança o cursor;
  - para com token inválido;
  - não roda com o espelho ativo;
  - não faz nada com a rotina desligada.
- **Registro do Pipedrive em duas empresas:** vale a versão mais recente.
