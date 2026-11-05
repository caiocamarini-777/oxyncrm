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
          <li>
            <strong>Dados das reuniões do Google Meet</strong> (participantes, título, horário e transcrição),
            somente quando o próprio usuário conecta a sua conta Google, a empresa liga o assistente de reuniões e a
            reunião tem convidado externo (veja as seções 4 e 5).
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Uso dos dados do Google (Gmail)">
        <p>
          A conexão com o Gmail é opcional e feita por cada usuário, no seu perfil, com a autorização da conta Google.
          Para o Gmail, o CRM pede apenas estes acessos (os do assistente de reuniões estão na seção 4):
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
      </LegalSection>

      <LegalSection title="4. Uso dos dados do Google (Google Meet e Agenda)">
        <p>
          O assistente de reuniões usa a mesma conexão do Google que o usuário faz no perfil para o Gmail e pede mais
          dois acessos, ambos somente de leitura. Quem já conectou a caixa precisa reconectar uma vez para autorizá-los.
        </p>
        <ul>
          <li>
            <strong>Leitura das reuniões do Google Meet</strong> (
            <code>https://www.googleapis.com/auth/meetings.space.readonly</code>): permite ao CRM consultar as reuniões
            feitas pela conta, com horário de início e fim, participantes e a transcrição gerada pelo próprio Meet. O
            CRM não baixa gravações de áudio ou vídeo e não cria, altera nem apaga reuniões.
          </li>
          <li>
            <strong>Leitura dos eventos da Agenda Google</strong> (
            <code>https://www.googleapis.com/auth/calendar.events.readonly</code>): permite ao CRM consultar os eventos
            da agenda principal da conta para achar o evento da reunião e ler o título e os convidados. O CRM não cria,
            altera nem apaga eventos.
          </li>
        </ul>
        <p>
          A transcrição só é lida quando a reunião tem pelo menos um convidado de fora das empresas do grupo e quando o
          assistente de reuniões está ligado para a empresa da caixa conectada. Reuniões só com gente interna são
          ignoradas, e, com o assistente desligado, nenhuma transcrição é lida. Esses dados são usados apenas para
          escrever a anotação da reunião e sugerir atualizações do funil, que aparecem para o vendedor, no registro do
          CRM correspondente, e só valem depois de ele confirmar.
        </p>
      </LegalSection>

      <LegalSection title="5. Processamento das transcrições e guarda no CRM">
        <ul>
          <li>
            <strong>Anthropic, fornecedora do processamento:</strong> para escrever a anotação, o texto da transcrição,
            o título, a data e os participantes da reunião, o roteiro de perguntas da empresa e um resumo do registro
            vinculado (etapa, valores e as últimas anotações) são enviados à Anthropic, que opera o modelo de
            inteligência artificial Claude por conta do CRM. Pelos termos comerciais da API da Anthropic, esses dados
            não são usados para treinar os modelos dela.
          </li>
          <li>
            <strong>Guarda no CRM:</strong> a transcrição e as notas geradas ficam guardadas no banco do CRM e são
            visíveis, no registro vinculado, para as pessoas que têm acesso a esse registro. A anotação (sem a
            transcrição) também é gravada no registro correspondente do Pipedrive, ferramenta comercial que o grupo
            ainda usa.
          </li>
          <li>
            <strong>Reuniões sem vínculo:</strong> quando o assistente não encontra um registro do CRM para a reunião,
            ela fica numa lista para o vendedor vincular ou descartar. Sem decisão em 7 dias, ela é descartada
            sozinha, e a transcrição e as notas são apagadas. O assistente nunca cria pessoa, organização, lead ou
            negócio.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Uso Limitado dos dados do Google">
        <p>
          O uso e a transferência, pelo Oxyn CRM, de informações recebidas das APIs do Google (Gmail, Google Meet e
          Google Agenda) seguem a{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
            Política de Dados do Usuário dos Serviços de API do Google
          </a>
          , incluindo os requisitos de Uso Limitado.
        </p>
        <p>
          Em particular, os dados do Google Meet e da Agenda são usados só para oferecer o assistente de reuniões ao
          próprio usuário, não são vendidos, não são usados para publicidade e não são usados para treinar modelos de
          inteligência artificial. Eles só são lidos por pessoas fora desse uso quando necessário para segurança, para
          cumprir a lei ou com o consentimento do usuário. O envio à Anthropic descrito na seção 5 serve apenas para
          gerar as notas da reunião.
        </p>
      </LegalSection>

      <LegalSection title="7. Onde os dados ficam">
        <p>
          Os dados ficam em banco de dados gerenciado pela Supabase, e o sistema roda na Vercel. Os e-mails automáticos
          do CRM (convites, redefinição de senha e lembretes) são enviados pela Resend, e as transcrições de reuniões são
          processadas pela Anthropic (seção 5). Os tokens de acesso ao Gmail
          são guardados criptografados (AES-256-GCM) e só são lidos pelo servidor. Toda a comunicação usa HTTPS.
        </p>
      </LegalSection>

      <LegalSection title="8. Por quanto tempo guardamos">
        <ul>
          <li>Os dados comerciais ficam enquanto forem necessários para a operação das empresas do grupo.</li>
          <li>
            Ao desconectar a caixa do Gmail no perfil, o acesso é revogado no Google e as mensagens importadas daquela
            caixa são apagadas do CRM. O assistente de reuniões também deixa de ler as reuniões dela.
          </li>
          <li>
            A transcrição e as notas de uma reunião vinculada ficam no CRM junto com o registro. Reuniões sem vínculo e
            sem decisão do vendedor são descartadas sozinhas em 7 dias, com a transcrição apagada. O vendedor também
            pode descartá-las antes disso.
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

      <LegalSection title="9. Seus direitos">
        <p>
          Você pode pedir acesso, correção, anonimização ou exclusão dos seus dados, além de informações sobre o
          compartilhamento, pelo e-mail <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>.
        </p>
      </LegalSection>

      <LegalSection title="10. Mudanças nesta política">
        <p>Quando esta política mudar, a data no topo da página será atualizada.</p>
      </LegalSection>
    </article>
  );
}
