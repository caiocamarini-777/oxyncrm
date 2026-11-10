-- Anotação do assistente de reuniões gravada direto no CRM (MEETING_SINK=crm).
--
-- * meeting_notes.crm_note_id: a nota do CRM criada pelo assistente. Guarda a ligação para a rodada não duplicar
--   a nota e para o histórico do card esconder a nota que já aparece no bloco da reunião. Se a nota for apagada,
--   a coluna volta a nulo (on delete set null) e a anotação da reunião continua guardada em meeting_notes.
--   Ao lado de pipedrive_note_id, que só vale no modo Pipedrive.

alter table public.meeting_notes
  add column crm_note_id uuid references public.notes on delete set null;

comment on column public.meeting_notes.crm_note_id is
  'Nota do CRM criada pelo assistente de reuniões no modo MEETING_SINK=crm (equivalente ao pipedrive_note_id).';
