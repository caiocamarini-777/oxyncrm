-- Nome (e estado de lixeira) de uma organização para quem tem acesso à empresa dela,
-- mesmo sem permissão de leitura do registro. Serve ao detalhe da pessoa, que mostra
-- "(sem acesso)" ou "(na lixeira)" em vez de esconder o vínculo. Devolve zero linhas
-- para empresa sem acesso ou id inexistente.
create function public.organization_label(p_id uuid)
returns table (name text, trashed boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.name, o.deleted_at is not null
  from public.organizations o
  where o.id = p_id
    and public.has_company_access(o.company_id);
$$;

revoke execute on function public.organization_label(uuid) from public, anon;
grant execute on function public.organization_label(uuid) to authenticated;
