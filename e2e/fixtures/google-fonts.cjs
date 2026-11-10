// CSS do Google Fonts para os servidores dos e2e (NEXT_FONT_GOOGLE_MOCKED_RESPONSES, ver playwright.config.ts).
// O next/font baixa esse CSS ao compilar. Às vezes o Google responde com URLs /l/font?kit=…&skey=…, e o `&` derruba
// o Turbopack ("next/font/google queries have exactly one entry"). O servidor fica respondendo 500 até reiniciar.
// Com o CSS fixo, só os arquivos .woff2 (estáveis, em /s/) são baixados.
// As chaves são as URLs que o next/font monta para as fontes de src/app/layout.tsx: ao mudar as fontes ou os
// pesos de lá, atualize aqui (o next dev dos e2e acusa "url not found").
const latin =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

const face = (family, weight, file) => `/* latin */
@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/${file}) format('woff2');
  unicode-range: ${latin};
}
`;

module.exports = {
  "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap": face(
    "Inter",
    "100 900",
    "inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2",
  ),
  "https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700&display=swap":
    face("Montserrat", 600, "montserrat/v31/JTUSjIg1_i6t8kCHKm459WlhyyTh89Y.woff2") +
    face("Montserrat", 700, "montserrat/v31/JTUSjIg1_i6t8kCHKm459WlhyyTh89Y.woff2"),
};
