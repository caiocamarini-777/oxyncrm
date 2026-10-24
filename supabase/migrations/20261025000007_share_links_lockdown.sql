-- Fase 6, correções da Task 4.
-- 1. dashboard_share_links só muda por RPC: create_share_link cria e revoke_share_link revoga. O cliente não
--    insere (escolheria o próprio token_hash) nem atualiza (desfaria a revogação). Select sem token_hash e
--    delete pelo dono continuam.
-- 2. Os filtros owner e team que restrict_filters acrescenta não contam no limite de 20 filtros da spec:
--    run_widget_as valida a spec do usuário antes de restringir e a spec restringida sem os filtros
--    acrescentados (os ids deles já foram validados como uuid por restrict_filter_ids), e despacha direto.

revoke insert, update on public.dashboard_share_links from authenticated;
drop policy links_insert on public.dashboard_share_links;
drop policy links_update on public.dashboard_share_links;

create or replace function public.run_widget_as(p_widget uuid, p_viewer uuid, p_companies uuid[], p_filters jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_spec jsonb;
  v_r record;
begin
  select coalesce(r.spec, w.spec) into v_spec
  from public.dashboard_widgets w
  left join public.reports r on r.id = w.report_id
  where w.id = p_widget;
  if v_spec is null then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  -- spec do usuário, com o limite de filtros
  perform public.validate_report_spec(v_spec);
  select * into v_r from public.restrict_filters(v_spec, p_filters, p_companies);
  -- spec restringida (período recortado) com os filtros originais; os acrescentados ficam fora do limite
  perform public.validate_report_spec(jsonb_set(v_r.spec, '{filters}',
    coalesce(nullif(v_spec->'filters', 'null'::jsonb), '[]'::jsonb)));
  if v_r.spec->>'kind' = 'custom' then
    return public.run_report_custom(v_r.spec, v_r.companies, p_viewer);
  end if;
  return public.run_report_preset(v_r.spec, v_r.companies, p_viewer);
end $$;

revoke execute on function public.run_widget_as(uuid, uuid, uuid[], jsonb)
  from public, anon, authenticated, service_role;
