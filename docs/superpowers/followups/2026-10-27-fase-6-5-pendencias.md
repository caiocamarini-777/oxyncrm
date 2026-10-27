# Fase 6.5 (painéis iguais ao Pipedrive): pendências

Estado: os painéis "KPIs - <EMPRESA>" e "<EMPRESA> - Resultados diretoria" existem nas 7 empresas (dev), donos de
caiocamarini@gmail.com e compartilhados com os membros de cada empresa. Recriar: `pnpm dashboards:pipedrive <email>`.

Conferência com o Pipedrive (HARPIX, "Este mês", 2026-10-27): Leads abertos 209 (-47, -18,4%), Número de atividades
731 (+288), Qualificados 7 (+4), Ganhos 6, Canal de origem de reuniões WhatsApp 11 / LinkedIn 1, Previsão de receita
915 mil e Leads abertos mensalmente (set 256, out 209) batem. Organizações criadas: 135 (Pipedrive 139).

## Diferenças conhecidas
- Filtro por criador do registro (creatorUserId do Pipedrive) não existe no Oxyn: omitido em "LEADS FÓRUM ECOMMERCE
  CONTATO ATIVO", "REUNIÕES REALIZADAS ORIGEM FÓRUM ECOMMERCE" e "OPORTUNIDADES GERADAS - BRASIL SESSIONS".
- "Conversão etapa a etapa" usa o relatório pronto de conversão por etapa; o período vem só do painel.
- "Ciclo de vendas (médio)": histórico de etapas reconstruído do fluxo do Pipedrive
  (`pnpm import:pipedrive-etapas`). Os valores por etapa ainda não foram conferidos um a um com o Pipedrive.
- Atividades por canal: reuniões sem canal aparecem como "Não informado" ao lado de "Reunião".
- Leads/negócios sem canal de origem aparecem como "Sem canal" (o Pipedrive omite a barra vazia).

## A fazer
- Levar o histórico de etapas para dentro do motor de importação (hoje é um script separado).
- Campos "de registro ligado" (exists) não aplicam a visibilidade do espectador ao registro ligado; só influenciam
  um booleano por linha. Avaliar se algum perfil restrito precisa disso.
- A migração 20261028000003 foi reaplicada à mão no banco de dev durante o desenvolvimento (create or replace);
  aplicar do zero gera o mesmo estado, mas vale validar no reset do banco de dev.
- Construtor de relatório: não há tela para escolher filtro por campo personalizado da pessoa (person.custom:...);
  só via catálogo/spec.
