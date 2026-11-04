import type { Metadata } from "next";
import { LEGAL_CONTACT, LEGAL_UPDATED, LegalSection, LegalTitle } from "@/components/legal/legal-doc";

export const metadata: Metadata = { title: "Política de Privacidade | Oxyn CRM" };

export default function PrivacyPage() {
  return (
    <article>
      <LegalTitle title="Política de Privacidade" updated={LEGAL_UPDATED} />

      <LegalSection title="1. Quem somos">
        <p>
          O Oxyn CRM (crm.oxyngroup.com.br) é o sistema comercial interno do Oxyn Group e das empresas do grupo. O
          acesso é restrito a usuários convidados por um administrador. Esta política explica quais dados o CRM trata,
          para quê, e como você pode exercer seus direitos previstos na Lei Geral de Proteção de Dados (Lei
          13.709/2018).
        </p>
      </LegalSection>

      <LegalSection title="2. Dados que tratamos">
        <ul>
          <li>
            <strong>Dados de conta dos usuários:</strong> nome, e-mail, empresas e papel de acesso, além de registros de
            login.
          </li>
          <li>
            <strong>Dados comerciais:</strong> pessoas, organizações, leads, negócios, atividades e anotações
            cadastrados pelos usuários ou importados das ferramentas que as empresas do grupo já usavam.
          </li>
          <li>
            <strong>Dados do Gmail</strong>, somente quando o próprio usuário conecta a sua caixa (veja a seção 3).
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Uso dos dados do Google (Gmail)">
        <p>
          A conexão com o Gmail é opcional e feita por cada usuário, no seu perfil, com a autorização da conta Google.
          O CRM pede apenas estes acessos:
        </p>
        <ul>
          <li>
            <strong>Endereço de e-mail da conta</strong> (openid, email), para identificar qual caixa foi conectada.
          </li>
          <li>
            <strong>Leitura do Gmail</strong> (gmail.readonly), para importar as conversas trocadas com contatos que
            já estão cadastrados no CRM: remetente, destinatários, assunto, data, texto da mensagem e nome dos anexos.
            Conversas com endereços que não são contatos do CRM não são gravadas. Rascunhos, spam, lixeira e chat são
            ignorados.
          </li>
          <li>
            <strong>Envio de e-mail</strong> (gmail.send), para enviar e responder mensagens pelo CRM, somente quando o
            usuário clica em enviar.
          </li>
        </ul>
        <p>
          Esses dados são usados só para mostrar o histórico de e-mails nos registros do CRM (pessoas, organizações,
          leads e negócios) às pessoas da mesma empresa que têm acesso a esses registros. O usuário pode marcar a sua
          caixa como privada. Os dados do Gmail não são vendidos, não são usados para publicidade, não são usados para
          treinar modelos de inteligência artificial e não são lidos por pessoas fora desse uso, exceto quando
          necessário para segurança, para cumprir a lei ou com o consentimento do usuário.
        </p>
        <p>
          O uso e a transferência, pelo Oxyn CRM, de informações recebidas das APIs do Google seguem a{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
            Política de Dados do Usuário dos Serviços de API do Google
          </a>
          , incluindo os requisitos de Uso Limitado.
        </p>
      </LegalSection>

      <LegalSection title="4. Onde os dados ficam">
        <p>
          Os dados ficam em banco de dados gerenciado pela Supabase, e o sistema roda na Vercel. Os e-mails automáticos
          do CRM (convites, redefinição de senha e lembretes) são enviados pela Resend. Os tokens de acesso ao Gmail
          são guardados criptografados (AES-256-GCM) e só são lidos pelo servidor. Toda a comunicação usa HTTPS.
        </p>
      </LegalSection>

      <LegalSection title="5. Por quanto tempo guardamos">
        <ul>
          <li>Os dados comerciais ficam enquanto forem necessários para a operação das empresas do grupo.</li>
          <li>
            Ao desconectar a caixa do Gmail no perfil, o acesso é revogado no Google e as mensagens importadas daquela
            caixa são apagadas do CRM.
          </li>
          <li>
            Você também pode revogar o acesso a qualquer momento em{" "}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
              myaccount.google.com/permissions
            </a>
            .
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Seus direitos">
        <p>
          Você pode pedir acesso, correção, anonimização ou exclusão dos seus dados, além de informações sobre o
          compartilhamento, pelo e-mail <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>.
        </p>
      </LegalSection>

      <LegalSection title="7. Mudanças nesta política">
        <p>Quando esta política mudar, a data no topo da página será atualizada.</p>
      </LegalSection>
    </article>
  );
}
