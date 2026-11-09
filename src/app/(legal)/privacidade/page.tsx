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
            <strong>Dados das reuniões do Google Meet</strong>, somente quando o próprio usuário conecta a sua conta
            Google e a empresa liga o assistente de reuniões. Das reuniões encerradas da conta conectada, o CRM lê o
            título, o horário e os participantes (nome e e-mail), para saber se há convidado externo. A transcrição
            (ou, quando a reunião não teve transcrição, as anotações do Gemini) só é lida quando há convidado externo
            (veja as seções 4 e 5).
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
          três acessos, todos somente de leitura. Quem já conectou a caixa precisa reconectar uma vez para autorizá-los.
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
          <li>
            <strong>Leitura dos arquivos criados pelo Google Meet no Drive</strong> (
            <code>https://www.googleapis.com/auth/drive.meet.readonly</code>): permite ao CRM ler o documento das
            anotações do Gemini (&quot;Anotações com o Gemini&quot;) de uma reunião que não teve transcrição. Esse
            acesso só alcança arquivos criados ou editados pelo Meet; o CRM não lê os demais arquivos do Drive, não
            baixa gravações e não cria, altera nem apaga arquivos.
          </li>
        </ul>
        <p>
          Com o assistente de reuniões ligado para a empresa da caixa conectada, o CRM lê o título, o horário e os
          participantes das reuniões encerradas da conta, para saber se há pelo menos um convidado de fora das
          empresas do grupo. Reuniões só com gente interna são marcadas como ignoradas, e a transcrição e as anotações
          do Gemini delas não são lidas. Com o assistente desligado, nada é lido. Esses dados são usados apenas para
          escrever a anotação da reunião e sugerir atualizações do funil para o vendedor.
        </p>
      </LegalSection>

      <LegalSection title="5. Processamento das transcrições e anotações e guarda no CRM">
        <ul>
          <li>
            <strong>Anthropic, fornecedora do processamento:</strong> para escrever a anotação, o texto da transcrição
            (ou das anotações do Gemini), o título, a data e os participantes da reunião, o roteiro de perguntas da
            empresa e um resumo do registro vinculado (nome, etapa, valores e as últimas anotações) são enviados à
            Anthropic, junto com os nomes dos resultados de reunião, dos tipos de atividade e das etapas do funil que o
            assistente pode sugerir. A Anthropic opera o modelo de inteligência artificial Claude por conta do CRM.
            Pelos termos comerciais da API da Anthropic, esses dados não são usados para treinar os modelos dela.
          </li>
          <li>
            <strong>Guarda no CRM:</strong> a transcrição (ou as anotações do Gemini) e as notas geradas ficam guardadas
            no banco do CRM e são
            visíveis, no registro vinculado, para as pessoas que têm acesso a esse registro. A anotação da reunião
            (sem a transcrição) é gravada direto no registro correspondente do Pipedrive, ferramenta comercial que o
            grupo ainda usa, sem esperar confirmação. Só as sugestões de atualização do funil (resultado da reunião,
            próxima atividade e etapa) dependem de o vendedor confirmar.
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
          do CRM (convites, redefinição de senha e lembretes) são enviados pela Resend, e as transcrições e anotações de
          reuniões são processadas pela Anthropic (seção 5). Os tokens de acesso ao Gmail
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
            A transcrição (ou as anotações do Gemini) e as notas de uma reunião vinculada ficam no CRM junto com o
            registro. Reuniões sem vínculo e sem decisão do vendedor são descartadas sozinhas em 7 dias, com esse texto
            apagado. O vendedor também
            pode descartá-las antes disso. Uma reunião ignorada (só com gente interna, sem a transcrição lida) ou
            descartada continua registrada no CRM com o título, os participantes (nome e e-mail), o horário e o
            identificador da reunião no Google, para não ser lida de novo. A transcrição e as notas da reunião
            descartada são apagadas.
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
