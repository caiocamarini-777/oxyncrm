-- Financeiro: a ponte negócio → contrato só cria rascunho na transição para ganho.
-- Editar um negócio que já estava ganho (ou os itens dele) só reconstrói um rascunho que já existe,
-- ou sinaliza source_changed num contrato já ativado; nunca cria rascunho novo.

create or replace function public.fin_sync_deal(p_deal uuid, p_was_won boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d public.deals;
  c public.fin_contracts;
begin
  select * into d from public.deals where id = p_deal;
  if not found then
    return;
  end if;
  if not coalesce((select finance_enabled from public.companies where id = d.company_id), false) then
    return;
  end if;
  if d.status <> 'won' and not p_was_won then
    return;
  end if;

  select * into c from public.fin_contracts where deal_id = p_deal;
  if found and c.status <> 'draft' then
    -- contrato já ativado: nada é apagado nem reconstruído; só sinaliza a divergência
    if not c.source_changed then
      update public.fin_contracts set source_changed = true where id = c.id;
    end if;
  elsif d.status = 'won' then
    -- cria só na transição para ganho; depois disso, só reconstrói o rascunho existente
    if found or not p_was_won then
      perform public.fin_draft_from_deal(p_deal);
    end if;
  elsif found then
    delete from public.fin_contracts where id = c.id;
  end if;
end $$;
revoke execute on function public.fin_sync_deal(uuid, boolean) from public, anon, authenticated;
