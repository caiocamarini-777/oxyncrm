-- Fase 3.5, task 4, correções 1: concessão (lease) do job para que só uma fatia rode por vez
-- (assistente e script de linha de comando podem chamar o mesmo job).

alter table public.import_jobs
  add column lease_owner uuid,
  add column lease_until timestamptz;

-- Toma a concessão se o job pode rodar e ela está livre, vencida ou já é de quem pede.
create function public.import_claim(p_job uuid, p_owner uuid, p_seconds int) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if p_owner is null or p_seconds is null or p_seconds < 1 or p_seconds > 3600 then
    raise exception 'OXYN_IMPORT_INVALID_LEASE';
  end if;
  update public.import_jobs
     set lease_owner = p_owner, lease_until = now() + make_interval(secs => p_seconds)
   where id = p_job
     and status in ('draft', 'running')
     and (lease_owner is null or lease_owner = p_owner or lease_until is null or lease_until < now())
  returning id into v_id;
  return v_id is not null;
end $$;

-- Libera a concessão só se ela é de quem pede.
create function public.import_release(p_job uuid, p_owner uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.import_jobs set lease_owner = null, lease_until = null
   where id = p_job and lease_owner = p_owner;
end $$;

revoke execute on function public.import_claim(uuid, uuid, int), public.import_release(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.import_claim(uuid, uuid, int), public.import_release(uuid, uuid)
  to service_role;
