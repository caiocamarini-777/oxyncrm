-- Financeiro: despesas recorrentes, geração de entries e extensão do horizonte.

create table public.fin_recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  description text not null check (length(btrim(description)) > 0),
  payee text,
  expense_category_id uuid not null references public.fin_expense_categories on delete restrict,
  nature text not null check (nature in ('fixed','variable','non_recurring')),
  amount numeric(14,2) not null check (amount > 0),
  frequency text not null default 'monthly' check (frequency in ('monthly','quarterly','yearly')),
  due_day int not null check (due_day between 1 and 31),
  start_month date not null check (start_month = date_trunc('month', start_month)::date),
  end_month date check (end_month = date_trunc('month', end_month)::date),
  installments int check (installments between 1 and 360),
  adjust_rate numeric(6,3) not null default 0,
  adjust_month int check (adjust_month between 1 and 12),
  account_id uuid references public.fin_accounts on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles default auth.uid(),
  updated_at timestamptz not null default now()
);
create index fin_recurring_expenses_company_idx on public.fin_recurring_expenses (company_id, active);

alter table public.fin_entries
  add constraint fin_entries_recurring_expense_fk
  foreign key (recurring_expense_id) references public.fin_recurring_expenses on delete set null;
create unique index fin_entries_recurring_competence_key on public.fin_entries (recurring_expense_id, competence)
  where recurring_expense_id is not null;

do $$
declare t text := 'fin_recurring_expenses';
begin
  execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from anon', t);
  execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  execute format('create policy %I on public.%I for select to authenticated using (public.can_finance(company_id, ''view''))', t || '_select', t);
  execute format('create policy %I on public.%I for insert to authenticated with check (public.can_finance(company_id, ''manage''))', t || '_insert', t);
  execute format('create policy %I on public.%I for update to authenticated using (public.can_finance(company_id, ''manage'')) with check (public.can_finance(company_id, ''manage''))', t || '_update', t);
  execute format('create policy %I on public.%I for delete to authenticated using (public.can_finance(company_id, ''manage''))', t || '_delete', t);
  execute format('create trigger guard_same_company before insert or update on public.%I for each row execute function public.guard_same_company()', t);
end $$;

-- guard_same_company: função completa, com todos os ramos anteriores intactos e os novos de despesas recorrentes
create or replace function public.guard_same_company() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j jsonb := to_jsonb(new);
  rec_company uuid;
  label_company uuid;
begin
  if tg_table_name = 'persons' then
    if new.organization_id is not null and
       (select company_id from public.organizations where id = new.organization_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'leads' then
    if new.person_id is not null and
       (select company_id from public.persons where id = new.person_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.organization_id is not null and
       (select company_id from public.organizations where id = new.organization_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.source_id is not null and
       (select company_id from public.lead_sources where id = new.source_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.disqualification_reason_id is not null and
       (select company_id from public.disqualification_reasons where id = new.disqualification_reason_id)
         is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.converted_deal_id is not null and
       (select company_id from public.deals where id = new.converted_deal_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'deals' then
    if (select company_id from public.pipelines where id = new.pipeline_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if not exists (select 1 from public.stages
                   where id = new.stage_id and company_id = new.company_id and pipeline_id = new.pipeline_id) then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.lost_reason_id is not null and
       (select company_id from public.lost_reasons where id = new.lost_reason_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.person_id is not null and
       (select company_id from public.persons where id = new.person_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.organization_id is not null and
       (select company_id from public.organizations where id = new.organization_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.lead_id is not null and
       (select company_id from public.leads where id = new.lead_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.service_category_id is not null and
       (select company_id from public.service_categories where id = new.service_category_id)
         is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'products' then
    if new.service_category_id is not null and
       (select company_id from public.service_categories where id = new.service_category_id)
         is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'activities' then
    if (select company_id from public.activity_types where id = new.type_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if (select company_id from public.activity_channels where id = new.channel_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.origin_channel_id is not null and
       (select company_id from public.activity_channels where id = new.origin_channel_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.outcome_id is not null and
       (select company_id from public.activity_outcomes where id = new.outcome_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.lead_id is not null and
       (select company_id from public.leads where id = new.lead_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.deal_id is not null and
       (select company_id from public.deals where id = new.deal_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.person_id is not null and
       (select company_id from public.persons where id = new.person_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.organization_id is not null and
       (select company_id from public.organizations where id = new.organization_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.booked_by_activity_id is not null and
       (select company_id from public.activities where id = new.booked_by_activity_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'fin_balance_snapshots' then
    if (select company_id from public.fin_accounts where id = new.account_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'fin_contracts' then
    if new.organization_id is not null and
       (select company_id from public.organizations where id = new.organization_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.deal_id is not null and
       (select company_id from public.deals where id = new.deal_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.account_id is not null and
       (select company_id from public.fin_accounts where id = new.account_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'fin_contract_lines' then
    if (select company_id from public.fin_contracts where id = new.contract_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.service_category_id is not null and
       (select company_id from public.service_categories where id = new.service_category_id)
         is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'fin_recurring_expenses' then
    if (select company_id from public.fin_expense_categories where id = new.expense_category_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.account_id is not null and
       (select company_id from public.fin_accounts where id = new.account_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'fin_entries' then
    -- Num UPDATE, só revalida o vínculo que mudou (ou todos, se mudou a empresa): o ON DELETE SET NULL
    -- em cascata ao apagar um contrato atualiza a entry quando a linha do contrato já não existe.
    if new.contract_id is not null
       and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id or new.contract_id is distinct from old.contract_id)
       and (select company_id from public.fin_contracts where id = new.contract_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.contract_line_id is not null
       and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id or new.contract_line_id is distinct from old.contract_line_id)
       and (select company_id from public.fin_contract_lines where id = new.contract_line_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.recurring_expense_id is not null
       and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id or new.recurring_expense_id is distinct from old.recurring_expense_id)
       and (select company_id from public.fin_recurring_expenses where id = new.recurring_expense_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.account_id is not null
       and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id or new.account_id is distinct from old.account_id)
       and (select company_id from public.fin_accounts where id = new.account_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.organization_id is not null
       and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id or new.organization_id is distinct from old.organization_id)
       and (select company_id from public.organizations where id = new.organization_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.service_category_id is not null
       and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id or new.service_category_id is distinct from old.service_category_id)
       and (select company_id from public.service_categories where id = new.service_category_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.income_category_id is not null
       and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id or new.income_category_id is distinct from old.income_category_id)
       and (select company_id from public.fin_income_categories where id = new.income_category_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.expense_category_id is not null
       and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id or new.expense_category_id is distinct from old.expense_category_id)
       and (select company_id from public.fin_expense_categories where id = new.expense_category_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'stages' then
    if (select company_id from public.pipelines where id = new.pipeline_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'deal_items' then
    if (select company_id from public.deals where id = new.deal_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if (select company_id from public.products where id = new.product_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.service_category_id is not null and
       (select company_id from public.service_categories where id = new.service_category_id)
         is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name in ('notes','record_labels') and
        coalesce(j->>'entity', '') not in ('leads','persons','organizations','deals') then
    return new; -- o CHECK de entity rejeita
  elsif tg_table_name = 'notes' then
    execute format('select company_id from public.%I where id = $1', j->>'entity')
      into rec_company using (j->>'record_id')::uuid;
    if rec_company is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'record_labels' then
    select company_id into label_company from public.labels where id = new.label_id;
    execute format('select company_id from public.%I where id = $1', new.entity)
      into rec_company using new.record_id;
    if rec_company is null or label_company is distinct from rec_company then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  end if;
  return new;
end $$;

-- Regera as entries de uma despesa recorrente. Só toca source_kind = 'recurring'; preserva liquidadas,
-- canceladas e locked, e não duplica a competência delas (índice único despesa+competência).
create or replace function public.fin_regenerate_recurring(p_expense uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e public.fin_recurring_expenses;
  v_horizon date := public.fin_horizon_end();
  v_step int;
  v_comp date;
  v_t0 int;
  v_d int;
  v_n int;
  v_gross numeric(14,2);
  i int := 0;
begin
  delete from public.fin_entries
   where recurring_expense_id = p_expense and source_kind = 'recurring' and status = 'open' and not locked;

  select * into e from public.fin_recurring_expenses where id = p_expense;
  if not found or not e.active then
    return;
  end if;
  v_step := case e.frequency when 'monthly' then 1 when 'quarterly' then 3 else 12 end;

  loop
    v_comp := (e.start_month + make_interval(months => i * v_step))::date;
    exit when v_comp >= v_horizon;
    exit when e.end_month is not null and v_comp > e.end_month;
    exit when e.installments is not null and i >= e.installments;

    -- n = vezes que adjust_month foi alcançado depois de start_month (sem contar o próprio start_month)
    v_n := 0;
    if e.adjust_month is not null then
      v_d := i * v_step;
      v_t0 := ((e.adjust_month - extract(month from e.start_month)::int) + 12) % 12;
      if v_t0 = 0 then v_t0 := 12; end if;
      if v_d >= v_t0 then
        v_n := 1 + (v_d - v_t0) / 12;
      end if;
    end if;
    v_gross := round(e.amount * power(1 + e.adjust_rate / 100, v_n::numeric), 2);

    insert into public.fin_entries (company_id, direction, source_kind, recurring_expense_id,
      due_date, competence, gross, account_id, expense_category_id, nature, description)
    values (e.company_id, 'out', 'recurring', e.id,
      public.fin_due_date(v_comp, e.due_day), v_comp, v_gross, e.account_id, e.expense_category_id, e.nature,
      case when e.installments is not null
           then e.description || ' (' || (i + 1) || '/' || e.installments || ')'
           else e.description end)
    on conflict (recurring_expense_id, competence) where recurring_expense_id is not null do nothing;
    i := i + 1;
  end loop;
end $$;
revoke execute on function public.fin_regenerate_recurring(uuid) from public, anon, authenticated;

create or replace function public.fin_recurring_regenerate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    -- antes de apagar: remove as abertas não travadas (liquidadas/locked ficam, com vínculo nulo)
    delete from public.fin_entries
     where recurring_expense_id = old.id and source_kind = 'recurring' and status = 'open' and not locked;
    return old;
  end if;
  perform public.fin_regenerate_recurring(new.id);
  return null;
end $$;
revoke execute on function public.fin_recurring_regenerate() from public, anon, authenticated;

create trigger fin_recurring_regenerate after insert or update on public.fin_recurring_expenses
  for each row execute function public.fin_recurring_regenerate();
create trigger fin_recurring_cleanup before delete on public.fin_recurring_expenses
  for each row execute function public.fin_recurring_regenerate();

-- Contrato encerrado ('ended') mantém as entries abertas (cobranças vencidas continuam visíveis):
-- a regeneração só roda para os demais status.
create or replace function public.fin_contracts_regenerate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    delete from public.fin_entries
     where contract_id = old.id and source_kind = 'contract' and status = 'open' and not locked;
    return old;
  end if;
  if new.status = 'ended' then
    return null;
  end if;
  perform public.fin_regenerate_contract(new.id);
  return null;
end $$;
revoke execute on function public.fin_contracts_regenerate() from public, anon, authenticated;

-- Extensão do horizonte (mensal): regera contratos e despesas ativos e encerra contratos 'ends' vencidos.
create or replace function public.fin_extend_horizon() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_month date := date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date;
begin
  for r in select id from public.fin_contracts where status = 'active' loop
    perform public.fin_regenerate_contract(r.id);
  end loop;
  for r in select id from public.fin_recurring_expenses where active loop
    perform public.fin_regenerate_recurring(r.id);
  end loop;
  update public.fin_contracts c set status = 'ended'
   where c.status = 'active' and c.end_rule = 'ends'
     and (select max(competence) from public.fin_entries
           where contract_id = c.id and source_kind = 'contract') < v_month;
end $$;
revoke execute on function public.fin_extend_horizon() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'fin-extend-horizon';
  perform cron.schedule('fin-extend-horizon', '0 6 1 * *', 'select public.fin_extend_horizon()');
end $$;
