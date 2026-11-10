import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Fontes guardadas no projeto (Inter e Montserrat variáveis, subconjunto latino, do Fontsource; licença OFL em
// ./fonts). Com next/font/google cada compilação baixava as fontes, e o Turbopack às vezes falhava nisso
// ("next/font/google queries have exactly one entry"), derrubando o next dev do CI.
const inter = localFont({ src: "./fonts/inter-latin-wght-normal.woff2", weight: "100 900", variable: "--font-inter" });
const montserrat = localFont({
  src: "./fonts/montserrat-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-montserrat",
});

export const metadata: Metadata = {
  title: "Oxyn CRM",
  description: "CRM multiempresa da Oxyn",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${inter.variable} ${montserrat.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
