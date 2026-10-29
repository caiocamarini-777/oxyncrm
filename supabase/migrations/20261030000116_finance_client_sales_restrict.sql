-- Financeiro: vendas do cliente não somem em cascata. Remover a linha de comissão ou o contrato
-- de uma venda passa a falhar (23503) em vez de apagar as vendas e as comissões abertas.
-- O delete inteiro é desfeito: a limpeza do before delete de fin_contracts (entries abertas do
-- contrato) é revertida junto com o comando.
alter table public.fin_client_sales
  drop constraint fin_client_sales_contract_id_fkey,
  add constraint fin_client_sales_contract_id_fkey
    foreign key (contract_id) references public.fin_contracts on delete restrict,
  drop constraint fin_client_sales_contract_line_id_fkey,
  add constraint fin_client_sales_contract_line_id_fkey
    foreign key (contract_line_id) references public.fin_contract_lines on delete restrict;
