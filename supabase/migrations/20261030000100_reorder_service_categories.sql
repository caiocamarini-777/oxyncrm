-- Reordena as categorias de serviço de uma empresa em um único UPDATE (atômico). Security invoker: RLS vale.
create function public.reorder_service_categories(p_company uuid, p_ids uuid[]) returns void
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_current uuid[];
begin
  if not public.is_super_admin() then
    raise exception 'OXYN_FORBIDDEN' using errcode = '42501';
  end if;
  select coalesce(array_agg(id order by id), '{}') into v_current
    from public.service_categories where company_id = p_company;
  if cardinality(p_ids) is distinct from cardinality(v_current)
     or (select coalesce(array_agg(x order by x), '{}') from unnest(p_ids) x) is distinct from v_current then
    raise exception 'OXYN_CATEGORIES_MISMATCH' using errcode = '22023';
  end if;
  update public.service_categories c set position = o.ord - 1
    from unnest(p_ids) with ordinality o(id, ord)
    where c.id = o.id and c.company_id = p_company;
end $$;
revoke execute on function public.reorder_service_categories(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_service_categories(uuid, uuid[]) to authenticated;
