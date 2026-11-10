# Assistente de reuniões gravando no CRM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Com `MEETING_SINK=crm`, o assistente de reuniões passa a gravar no CRM:
- a anotação da reunião;
- a conclusão da reunião;
- a próxima atividade;
- a etapa do negócio.

O modo Pipedrive continua igual, e há uma trava que impede gravar no CRM enquanto o modo espelho estiver ativo.

**Architecture:**
- **Escritas no CRM:** ficam num módulo novo, `src/lib/meet/crm-sink.ts`, que trabalha com os ids do CRM.
- **`run.ts` (anotação, pelo cron):** escolhe o destino por `meetingSinkMode()` e usa o cliente admin.
- **`actions.ts` (sugestões confirmadas pelo vendedor):** também escolhe o destino por `meetingSinkMode()`, mas usa o cliente do usuário, com RLS e gatilhos normais.
- **Caminho do Pipedrive:** fica intacto.
- **Nomes que vão para o Claude:** no modo CRM, vêm dos cadastros do CRM.

**Tech Stack:** Next.js 16, Supabase, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-09-reunioes-no-crm-design.md`

**Ruling sobre a spec:** a spec propõe trocar a interface `MeetingSink` para alvos do CRM e esconder a conversão do Pipedrive dentro do `pipedriveSink`. O plano não faz isso: mantém o `pipedriveSink` e os chamadores atuais e acrescenta o caminho do CRM ao lado.
- **Por quê:** menos risco para o assistente que já está no ar. O caminho do Pipedrive deixa de existir na virada.
- **Comportamento:** o mesmo da spec.

## Global Constraints

- Textos de interface, erros e comentários em português do Brasil, no estilo do código vizinho.
- Comandos com `export PATH=$HOME/.local/node/bin:$PATH`. Antes de cada commit, `pnpm typecheck`, `pnpm lint` e o vitest da área precisam passar.
- Só existe banco de produção. Nunca rodar migration nem nada que escreva no banco. Quem aplica é o controlador, com ok do usuário.
- Não reformatar arquivos inteiros.
- Commits em português, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Valores da spec:
  - variável `MEETING_SINK`, com `pipedrive` (padrão) ou `crm`;
  - o espelho conta como ativo quando o último job de importação concluído é espelho e terminou há menos de 48 h;
  - aviso: `modo espelho ativo: o Pipedrive apagaria o que fosse gravado no CRM`;
  - erro de etapa: `Faltam campos para esta etapa: …`.

## Review Focus

1. **`MEETING_SINK=crm` com o espelho ainda ligado.** Nada é gravado e a reunião não gasta tentativas. Teste na Task 3.
2. **Reunião vinculada a uma organização no modo CRM.** Grava a anotação e as sugestões que fazem sentido; a etapa continua só para negócio. Testes nas Tasks 2 e 4.
3. **Sugestão de etapa com campo obrigatório faltando.** Fica `failed`, com a lista de campos em português, sem mudar nada. Teste na Task 2.
4. **Âncora já concluída pelo vendedor antes de confirmar o resultado.** Não lança erro técnico; cria a reunião concluída ou responde com uma mensagem clara. Teste na Task 2.
5. **Anotação do assistente aparecendo duas vezes no card** (no bloco da reunião e no histórico). Fica escondida no histórico pelo `crm_note_id`. Teste na Task 3.

---

### Task 1: Migration e modo de gravação

**Files:**
- Create: `supabase/migrations/20261112000001_meeting_crm_note.sql`
- Create: `src/lib/meet/sink-mode.ts`
- Test: `src/lib/meet/sink-mode.test.ts`

**Interfaces:**
- Produces:
  - a coluna `meeting_notes.crm_note_id uuid references public.notes on delete set null`;
  - as funções abaixo:

```ts
export type MeetingSinkMode = "pipedrive" | "crm";
export function meetingSinkMode(env?: string | undefined): MeetingSinkMode; // lê process.env.MEETING_SINK; inválido/ausente → "pipedrive"
export const MIRROR_GUARD_MS = 48 * 3600_000;
export const MIRROR_ACTIVE_ERROR = "modo espelho ativo: o Pipedrive apagaria o que fosse gravado no CRM";
export async function mirrorActive(db: SupabaseClient, now: Date): Promise<boolean>;
// último import_jobs source='pipedrive' status='done' por finished_at desc: mirror=true e finished_at > now-48h
```

- [ ] **Step 1: Testes que falham**
  - `meetingSinkMode("crm")` devolve `"crm"`;
  - `undefined`, `""` e `"CRM "` com espaço viram `"crm"` só depois de `trim().toLowerCase()`;
  - `"xyz"` vira `"pipedrive"`;
  - `mirrorActive`, com banco falso (`src/lib/meet/fake-db.test-support.ts`):
    - espelho que terminou há 2 h devolve `true`;
    - espelho que terminou há 49 h devolve `false`;
    - último job sem espelho devolve `false`;
    - sem nenhum job, devolve `false`.
- [ ] **Step 2: Rodar e ver falhar.** `pnpm vitest run src/lib/meet/sink-mode.test.ts`
- [ ] **Step 3: Implementar a migration** (uma coluna e um comentário) **e o `sink-mode.ts`.** NÃO aplicar a migration.
- [ ] **Step 4: Rodar e ver passar**
- [ ] **Step 5: Commit.** `feat(reunioes): modo de gravação no CRM e trava do espelho`

---

### Task 2: Escritas no CRM

**Files:**
- Create: `src/lib/meet/crm-sink.ts`
- Test: `src/lib/meet/crm-sink.test.ts`

**Interfaces:**
- Consumes:
  - `MEETING_OUTCOME_LABELS` e `MeetingOutcome` (`src/lib/activities/schema.ts`);
  - a RPC `complete_activity(p_id, p_outcome_id, p_meeting_outcome, p_note, p_meeting, p_next)`;
  - `translateDbError` (`src/lib/db-errors`).
- Produces:

```ts
export type CrmTarget = { companyId: string; entity: "deals" | "leads" | "persons" | "organizations"; recordId: string };
/** Cron (cliente admin): grava a anotação com created_by = dono. Corpo cortado em 10.000. Devolve o id da nota. */
export async function writeCrmNote(db: SupabaseClient, t: CrmTarget, html: string, ownerId: string): Promise<string>;
export class CrmSinkUserError extends Error {} // erro que o vendedor corrige (vira `failed` com a mensagem)
/** As três abaixo recebem o cliente do USUÁRIO (RLS e gatilhos normais; autoria = quem confirmou). */
export async function completeCrmMeeting(client: SupabaseClient, t: CrmTarget, a: {
  anchorActivityId: string | null; outcomeLabel: string; subject: string; startedAt: string; ownerId: string;
}): Promise<void>;
export async function createCrmActivity(client: SupabaseClient, t: CrmTarget, a: {
  type: string; subject: string; dueDate: string; dueTime: string | null; ownerId: string; anchorActivityId: string | null;
}): Promise<void>;
export async function moveCrmStage(client: SupabaseClient, dealId: string, stageName: string): Promise<void>;
/** Nomes que vão para o Claude no modo CRM. */
export async function loadCrmNames(db: SupabaseClient, companyId: string): Promise<{ outcomes: string[]; activityTypes: string[] }>;
```

- [ ] **Step 1: Testes que falham**

Com banco falso. Os casos a cobrir:

- **`writeCrmNote`:**
  - insere em `notes` com `{company_id, entity, record_id, body, created_by}` e devolve o id;
  - corpo com mais de 10.000 caracteres é cortado.
- **`completeCrmMeeting`:**
  - **Rótulo do resultado:** vira o código pela tabela inversa de `MEETING_OUTCOME_LABELS`, sem diferenciar maiúsculas nem espaços (`"realizada"` → `held`). Rótulo desconhecido lança `CrmSinkUserError("O resultado \"X\" não existe no CRM.")`.
  - **Com âncora aberta:** chama `complete_activity` com `p_id = âncora`, `p_meeting_outcome = código` e os outros parâmetros nulos.
  - **Âncora concluída ou apagada:** segue como sem âncora.
  - **Sem âncora:** insere a atividade de reunião com:
    - tipo `is_meeting` ativo da empresa;
    - canal pela regra do `createCrmActivity`;
    - `due_at = startedAt`, assunto = `subject`, `owner_id = ownerId`;
    - vínculo pelo alvo: o campo certo `deal_id`, `lead_id`, `person_id` ou `organization_id`.

    Depois conclui pela RPC.
  - **Erro da RPC** (`OXYN_*`): vira `CrmSinkUserError` com `translateDbError`.
- **`createCrmActivity`:**
  - tipo pelo nome (sem diferenciar maiúsculas), entre os ativos da empresa; desconhecido lança `CrmSinkUserError("O tipo \"X\" não existe no CRM.")`;
  - `due_at` montado de `dueDate` e `dueTime` no fuso de São Paulo (use `toUtc` de `src/lib/activities/time`); sem hora, 09:00;
  - canal: o da âncora, se existir; senão "Videochamada"; senão o primeiro canal ativo e não legado da empresa;
  - vínculo pelo alvo.
- **`moveCrmStage`:**
  - etapa pelo nome dentro do funil do negócio, ignorando as arquivadas;
  - nome inexistente lança `CrmSinkUserError("A etapa \"X\" não existe no funil deste negócio.")`;
  - `update deals set stage_id`;
  - erro `OXYN_REQUIRED_FIELDS` lança `CrmSinkUserError("Faltam campos para esta etapa: …")`, com os nomes legíveis dos campos que `translateDbError` já produz (conferir em `src/lib/db-errors`).
- **`loadCrmNames`:**
  - `outcomes` são os quatro rótulos de `MEETING_OUTCOME_LABELS`;
  - `activityTypes` são os nomes dos `activity_types` ativos da empresa, por `position`.

- [ ] **Step 2: Rodar e ver falhar.** `pnpm vitest run src/lib/meet/crm-sink.test.ts`
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit.** `feat(reunioes): escritas do assistente direto no CRM`

---

### Task 3: Anotação pelo cron no modo CRM

**Files:**
- Modify: `src/lib/meet/run.ts`, `src/lib/meet/queries.ts`, `src/lib/timeline/queries.ts`
- Test: `src/lib/meet/run.test.ts`, `src/lib/meet/queries.test.ts`

**Interfaces:**
- Consumes: Tasks 1 e 2.
- Produces:
  - `MeetDeps` ganha `sinkMode?: MeetingSinkMode`, com padrão `meetingSinkMode()` em `defaultMeetDeps`;
  - em `src/lib/meet/queries.ts`, `getMeetingCrmNoteIds(entity, recordId): Promise<Set<string>>`;
  - `hideMeetingNotes` passa a esconder também as notas cujo `note.id` está nesse conjunto.

- [ ] **Step 1: Testes que falham** (em `run.test.ts`)
  - **Modo `crm` com o espelho ativo** (último job espelho há 1 h):
    - o `advance` não grava nada;
    - a reunião fica `processing` com `last_error = MIRROR_ACTIVE_ERROR`;
    - `attempts` não aumenta;
    - `sink.writeNote` não é chamado.
  - **Modo `crm` sem espelho:**
    - grava a nota via `writeCrmNote`;
    - `meeting_notes.crm_note_id` e `written_at` preenchidos;
    - `pipedrive_note_id` continua nulo;
    - a reunião fica `done`;
    - `sink.writeNote` (Pipedrive) não é chamado.
  - **Organização no modo `crm`:** grava a nota no registro da organização. No modo `pipedrive` continua lançando como hoje.
  - **Nomes para o Claude no modo `crm`:** saem de `loadCrmNames`, e `pipedriveNames` não é chamado.
  - **Repetição segura:** com `crm_note_id` já preenchido, não grava de novo. É a mesma regra de `pipedrive_note_id`.
  - **`queries.test.ts`:** `hideMeetingNotes` esconde a nota pelo id que está em `getMeetingCrmNoteIds`.
- [ ] **Step 2: Rodar e ver falhar.** `pnpm vitest run src/lib/meet`
- [ ] **Step 3: Implementar.**
  - No `advance`:
    - no modo `crm`, consulta `mirrorActive` antes de qualquer gravação;
    - se o espelho estiver ativo, grava o aviso e sai sem contar tentativa. O chamador hoje conta a tentativa no erro; use um retorno específico, não uma exceção.
  - O caminho da nota escolhe entre o Pipedrive e o CRM pelo modo.
  - `generateAndStore` usa `loadCrmNames` no modo `crm`.
  - A verificação "já gravada" olha a coluna do modo.
  - Em `src/lib/timeline/queries.ts`, junta os ids de `getMeetingCrmNoteIds` aos que já são escondidos.
- [ ] **Step 4: Rodar e ver passar.** `pnpm vitest run src/lib/meet src/lib/timeline && pnpm typecheck`
- [ ] **Step 5: Commit.** `feat(reunioes): anotação do assistente gravada no CRM`

---

### Task 4: Sugestões confirmadas no modo CRM e documentação da virada

**Files:**
- Modify: `src/lib/meet/actions.ts`
- Test: `src/lib/meet/actions.test.ts`
- Create: `docs/virada-pipedrive.md`

**Interfaces:**
- Consumes: Tasks 1 e 2.

- [ ] **Step 1: Testes que falham** (em `actions.test.ts`)
  - **Modo `crm`:**
    - `confirmSuggestion` de `meeting_outcome` chama `completeCrmMeeting` com o cliente do usuário (mock de `createServerClient`) e a âncora da reunião;
    - `next_activity` chama `createCrmActivity`;
    - `stage` chama `moveCrmStage` (só em negócio);
    - nada do Pipedrive é chamado;
    - um `CrmSinkUserError` deixa a sugestão `failed` com a mensagem.
  - **Modo `crm` com o espelho ativo:** a confirmação responde `{ok:false, error: MIRROR_ACTIVE_ERROR}` e a sugestão fica pendente.
  - **Organização no modo `crm`:**
    - `meeting_outcome` e `next_activity` funcionam;
    - `stage` responde "A etapa só pode ser movida em um negócio."
  - **Modo `pipedrive`:** os testes atuais continuam passando sem mudança.
- [ ] **Step 2: Rodar e ver falhar.** `pnpm vitest run src/lib/meet/actions.test.ts`
- [ ] **Step 3: Implementar.**
  - **`applySuggestion` com o modo `crm`:**
    - usa `createServerClient()` para as escritas;
    - mantém o cliente admin só para as leituras de controle que já existem;
    - trata `CrmSinkUserError` como hoje trata `UserError`.
  - **`docs/virada-pipedrive.md`:** roteiro curto e numerado do dia da virada, com estes passos:
    1. congelar o Pipedrive;
    2. rodar a última sincronização e o `pnpm import:pipedrive-arquivos`;
    3. tirar o `--espelho` da rotina diária (`.github/workflows/sync-pipedrive.yml`) e desligar a rotina;
    4. `MEETING_SINK=crm` na Vercel e publicar de novo;
    5. vendedores desligam a agenda no Pipedrive;
    6. ligar a Agenda nas empresas, em Configurações → Agenda do Google;
    7. conferir com curl as rotas `/api/cron/*` (401);
    8. exportação completa do Pipedrive;
    9. cancelar o Pipedrive depois de 1 a 2 semanas.
- [ ] **Step 4: Rodar e ver passar.** `pnpm vitest run && pnpm typecheck && pnpm lint`
- [ ] **Step 5: Commit.** `feat(reunioes): sugestões confirmadas no CRM e roteiro da virada`
