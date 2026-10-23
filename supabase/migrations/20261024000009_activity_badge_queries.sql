-- Selo de próxima atividade: filtro de atrasadas como campo computado e último canal em lote.

-- Atividades abertas por negócio (apoia has_overdue_activity e next_activity_for).
create index if not exists activities_open_deal_idx on public.activities (deal_id, due_at)
  where not done and deleted_at is null;

-- Campo computado do PostgREST: `?has_overdue_activity=is.true` vale também para as funções
-- que retornam `setof deals` (deals_with_labels). Invoker: respeita a RLS de quem consulta.
create or replace function public.has_overdue_activity(public.deals) returns boolean
language sql stable security invoker as $$
  select exists (
    select 1 from public.activities a
    where a.deal_id = $1.id and a.deleted_at is null and not a.done and a.due_at < pg_catalog.now()
  );
$$;
revoke execute on function public.has_overdue_activity(public.deals) from public, anon;
grant execute on function public.has_overdue_activity(public.deals) to authenticated;

-- Canal da última atividade concluída de cada lead.
create or replace function public.last_channel_for(p_ids uuid[])
returns table (lead_id uuid, channel_name text)
language sql stable security invoker as $$
  select distinct on (a.lead_id) a.lead_id, c.name
  from public.activities a
  join public.activity_channels c on c.id = a.channel_id
  where a.lead_id = any(p_ids) and a.done and a.deleted_at is null
  order by a.lead_id, a.completed_at desc, a.id;
$$;
revoke execute on function public.last_channel_for(uuid[]) from public, anon;
grant execute on function public.last_channel_for(uuid[]) to authenticated;
