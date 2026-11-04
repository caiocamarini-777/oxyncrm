import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_CONTACT, LEGAL_UPDATED, LegalSection, LegalTitle } from "@/components/legal/legal-doc";

export const metadata: Metadata = { title: "Termos de Uso | Oxyn CRM" };

export default function TermsPage() {
  return (
    <article>
      <LegalTitle title="Termos de Uso" updated={LEGAL_UPDATED} />

      <LegalSection title="1. O serviço">
        <p>
          O Oxyn CRM é a ferramenta comercial interna do Oxyn Group e das empresas do grupo. Ele é usado para organizar
          contatos, oportunidades, atividades e o histórico de e-mails com clientes.
        </p>
      </LegalSection>

      <LegalSection title="2. Quem pode usar">
        <p>
          O acesso é feito por convite de um administrador e é pessoal. Cada usuário enxerga apenas as empresas e os
          registros liberados para o seu papel. O administrador pode alterar ou desativar o acesso a qualquer momento.
        </p>
      </LegalSection>

      <LegalSection title="3. Responsabilidades do usuário">
        <ul>
          <li>Manter a senha em sigilo e não compartilhar a conta.</li>
          <li>Cadastrar informações corretas e usar o CRM só para as atividades comerciais das empresas do grupo.</li>
          <li>
            Ao conectar o Gmail, conectar apenas uma caixa que você tem direito de usar e enviar mensagens pelo CRM de
            acordo com a lei e as políticas da empresa.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Integração com o Gmail">
        <p>
          A conexão é opcional e pode ser desfeita a qualquer momento no perfil. O tratamento dos dados do Google está
          descrito na <Link href="/privacidade">Política de Privacidade</Link>.
        </p>
      </LegalSection>

      <LegalSection title="5. Disponibilidade">
        <p>
          O CRM é oferecido como está. Buscamos mantê-lo disponível e seguro, mas pode haver interrupções para
          manutenção ou por falhas de serviços de terceiros.
        </p>
      </LegalSection>

      <LegalSection title="6. Contato">
        <p>
          Dúvidas sobre estes termos: <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>.
        </p>
      </LegalSection>
    </article>
  );
}
