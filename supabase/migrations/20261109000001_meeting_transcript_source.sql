-- Origem do texto guardado em meeting_transcripts.
--
-- * transcript: a transcrição do Meet (fala a fala, com `entries`).
-- * gemini_notes: as anotações do Gemini ("Anotações com o Gemini"), usadas quando a reunião não tem transcrição.
--   É um resumo, não a conversa inteira; `entries` fica vazio.

alter table public.meeting_transcripts
  add column source text not null default 'transcript'
  check (source in ('transcript', 'gemini_notes'));
