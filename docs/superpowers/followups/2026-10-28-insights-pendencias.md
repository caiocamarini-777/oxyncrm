# Insights (relatórios e painéis no modelo do Pipedrive): pendências

Estado em 2026-10-28, no banco de dev. Tudo foi trazido exatamente como está no Insights do Pipedrive.

**Painéis:** os mesmos 8 do Pipedrive, com o mesmo nome, os mesmos relatórios e as mesmas posições.

| Empresa | Painéis |
|---|---|
| FQDTV | KPIS - FQDTV (7) |
| HARPIX | KPIS - HARPIX novo (34), HARPIX - Resultados diretoria (15) |
| NAIA | KPIS - NAIA (22), NAIA - Resultados diretoria (15) |
| OMNI11 | KPIS - OMNI11 novo (27), OMNI11 - Resultados diretoria (15) |
| Oxyn | KPIS - OXYN GROUP (27) |

**Relatórios avulsos:** os 79 que no Pipedrive não estão em painel.
- Cada um foi para a empresa a que se refere, pela etiqueta, pela "Empresa Proprietária", pelo funil ou pelo nome.
- Os que não indicam empresa foram para a Oxyn.
- EQUILIBRION e FQD STUDIOS não têm painel no Pipedrive, então ficaram só com relatórios avulsos.

**Dono e acesso:**
- O dono de tudo é caiocamarini@gmail.com.
- Painéis e relatórios avulsos estão compartilhados com os membros ativos da empresa.
- O filtro rápido de período é o que estava salvo no Pipedrive.

**Para recriar:** `pnpm insights:pipedrive <email> [slug ...]`. O script apaga e recria pelo nome, inclusive os painéis do modelo "novo" de antes.

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

- Rodei os 241 relatórios (dos painéis e avulsos), com o filtro rápido "Mês passado" e a lista de registros, sem nenhum erro.

## Diferenças conhecidas
- **Leads de setembro da OMNI11 (83 contra 93):** no Pipedrive há 10 leads com a etiqueta OMNI11 que a importação colocou em outra empresa. A importação usa o campo "Empresa Proprietária", e o Pipedrive usa a etiqueta. O motor não está errado; quem decide é a regra de empresa da importação.
- **Atividades do mês:** o Pipedrive tem atividades criadas depois da importação. Basta reimportar para os números baterem.
- **Etiqueta da empresa e "Empresa Proprietária":** saem dos relatórios, porque o escopo já é a empresa. Quando a etiqueta vem de um registro ligado ("o lead da atividade tem a etiqueta OMNI11"), vira "tem lead ligado".
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
