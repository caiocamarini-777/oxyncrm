# Insights (relatórios e painéis no modelo do Pipedrive): pendências

Estado em 2026-10-28:
- O módulo novo substitui os relatórios e dashboards das fases 6 e 6.5.
- Os painéis "KPIs - <EMPRESA>" e "<EMPRESA> - Resultados diretoria" existem nas 7 empresas, no banco de dev.
- O dono é caiocamarini@gmail.com, e os painéis estão compartilhados com os membros de cada empresa.
- Para recriar: `pnpm insights:pipedrive <email> [slug ...]`.

## Conferência com o Pipedrive (OMNI11, "Este mês")
A tela do Pipedrive foi lida em 2026-10-27; os dados do Oxyn vêm da importação de 2026-10-27.

| Relatório | Pipedrive | Oxyn |
|---|---|---|
| Leads abertos | 150 (anterior 93) | 150 (anterior 83) |
| Organizações | 127 (anterior 47) | 126 (anterior 47) |
| Número de atividades | 327 (anterior 143) | 311 (anterior 143) |
| Origem | 81 / 41 | 81 / 41 |
| Canal de origem de reuniões | 8 | 8 |
| Qualificados | 0 (anterior 1) | 0 (anterior 1) |

- Rodei os 277 relatórios dos 14 painéis, com o filtro rápido "Mês passado" e a lista de registros, sem nenhum erro.

## Diferenças conhecidas
- **Leads de setembro da OMNI11 (83 contra 93):** no Pipedrive há 10 leads com a etiqueta OMNI11 que a importação colocou em outra empresa. A importação usa o campo "Empresa Proprietária", e o Pipedrive usa a etiqueta. O motor não está errado; quem decide é a regra de empresa da importação.
- **Atividades do mês:** o Pipedrive tem atividades criadas depois da importação. Basta reimportar para os números baterem.
- **Etiqueta da empresa:** sai dos relatórios, porque o escopo já é a empresa. Quando a etiqueta vem de um registro ligado ("o lead da atividade tem a etiqueta OMNI11"), vira "tem lead ligado".
- **Resultados de reunião:** "Não compareceu" e "Remarcada" do Pipedrive viram o "Resultado da reunião" do Oxyn (meeting_outcome).
- **"Fonte do lead" (leadSource):** é um campo de sistema do Pipedrive e não existe no Oxyn. As colunas com esse campo foram retiradas.
- **Chips do painel:** não mostram o nome da empresa (o Pipedrive mostra "OMNI11 · ESTE MÊS"), porque a etiqueta da empresa sai.
- **Conferência automática:** a API de gráficos do Pipedrive (`insights-api/<entidade>/chart`) não aceita os filtros pelo token. O formato dos filtros é interno da tela. Os números acima foram conferidos pela tela.

## A fazer
- Campos ligados não aplicam a visibilidade de quem vê ao registro ligado. Eles só filtram o registro principal, como antes.
- O cartão do painel em tela estreita (menos de cerca de 1200px de largura útil) aperta as barras horizontais. Avaliar uma grade de 2 colunas abaixo dessa largura.
- O motor antigo (`run_report*`, presets) continua no banco só para as metas. Dá para levar o cálculo das metas para o motor novo e apagar o antigo.
- O histórico de etapas ainda é refeito por um script à parte (`pnpm import:pipedrive-etapas`).
- O "Gerar relatório (IA)" do Pipedrive ficou fora do escopo.
