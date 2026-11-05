import { INVITE_TTL_HOURS } from "@/lib/users/invite-status";

type Built = { subject: string; html: string; text: string };

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Paleta do Manual de Marca Oxyn Group v1.0: cores sólidas, sem degradê, cantos discretos.
const C = {
  navy: "#141C22",
  azul: "#1A82A2",
  ceu: "#A2D2DF",
  nevoa: "#D0E7EC",
  ardosia: "#5D6C89",
  cinza: "#EDEEED",
  borda: "#D9DBD9",
  texto: "#141C22",
};
const FONT = "Montserrat,'Helvetica Neue',Helvetica,Arial,sans-serif";
const DATA_FONT = "Barlow,'Helvetica Neue',Helvetica,Arial,sans-serif";

/** Origem do CRM tirada do próprio link do e-mail (o logo é servido em /email/ do mesmo endereço). */
function origin(link: string): string {
  try {
    return new URL(link).origin;
  } catch {
    return "";
  }
}

type Detail = { label: string; value: string; data?: boolean };

function layout(opts: {
  eyebrow: string;
  title: string;
  preheader: string;
  paragraphs: string[];
  details?: Detail[];
  button: string;
  link: string;
  note?: string;
}): string {
  const href = esc(opts.link);
  const logo = `${origin(opts.link)}/email/logo-oxyn-branco.png`;
  const paras = opts.paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:25px;color:${C.texto};">${p}</p>`)
    .join("");
  const details = opts.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 8px;background:${C.cinza};border-left:3px solid ${C.azul};border-radius:0 4px 4px 0;">
${opts.details
  .map(
    (d) => `<tr><td style="padding:14px 20px 0;font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:${C.ardosia};">${d.label}</td></tr>
<tr><td style="padding:4px 20px 14px;font-family:${d.data ? DATA_FONT : FONT};font-size:${d.data ? "18px" : "16px"};font-weight:600;line-height:24px;color:${C.texto};">${d.value}</td></tr>`,
  )
  .join("")}
</table>`
    : "";
  const note = opts.note
    ? `<p style="margin:24px 0 0;font-family:${FONT};font-size:13px;line-height:21px;color:${C.ardosia};">${opts.note}</p>`
    : "";
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${opts.title}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@600&family=Montserrat:wght@400;600;700&display=swap" rel="stylesheet">
<style>@media (max-width:480px){.px{padding-left:24px!important;padding-right:24px!important}.pt{padding-top:36px!important}}</style>
</head>
<body style="margin:0;padding:0;background:${C.cinza};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${opts.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cinza};"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td class="px" style="background:${C.navy};border-radius:4px 4px 0 0;padding:32px 48px;">
<img src="${logo}" width="132" height="47" alt="Oxyn Group" style="display:block;border:0;outline:none;height:47px;width:132px;font-family:${FONT};font-size:20px;font-weight:700;letter-spacing:3px;color:#ffffff;">
</td></tr>
<tr><td style="background:${C.azul};height:3px;line-height:3px;font-size:0;">&nbsp;</td></tr>
<tr><td class="px pt" style="background:#ffffff;padding:48px 48px 40px;">
<p style="margin:0 0 12px;font-family:${FONT};font-size:12px;font-weight:600;letter-spacing:1.6px;text-transform:uppercase;color:${C.azul};">${opts.eyebrow}</p>
<h1 style="margin:0 0 24px;font-family:${FONT};font-size:26px;line-height:34px;font-weight:700;color:${C.navy};">${opts.title}</h1>
${paras}
${details}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:32px 0 0;"><tr><td style="background:${C.azul};border-radius:4px;">
<a href="${href}" style="display:inline-block;padding:16px 32px;font-family:${FONT};font-size:14px;font-weight:600;letter-spacing:.6px;color:#ffffff;text-decoration:none;">${opts.button}&nbsp;&nbsp;&rarr;</a>
</td></tr></table>
${note}
</td></tr>
<tr><td class="px" style="background:#ffffff;border-top:1px solid ${C.borda};padding:24px 48px 32px;border-radius:0 0 4px 4px;">
<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:19px;color:${C.ardosia};">Se o botão não funcionar, copie este endereço no navegador:</p>
<p style="margin:0;font-family:${FONT};font-size:12px;line-height:19px;word-break:break-all;"><a href="${href}" style="color:${C.azul};text-decoration:underline;">${href}</a></p>
</td></tr>
<tr><td align="center" style="padding:28px 24px 0;">
<p style="margin:0 0 4px;font-family:${FONT};font-size:12px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:${C.navy};">Oxyn CRM</p>
<p style="margin:0;font-family:${FONT};font-size:12px;line-height:19px;color:${C.ardosia};">Mensagem automática do Oxyn Group. Não responda este e-mail.</p>
</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}

export function inviteEmail(p: { fullName: string; link: string }): Built {
  const name = esc(p.fullName);
  return {
    subject: "Seu acesso ao Oxyn CRM",
    html: layout({
      eyebrow: "Boas-vindas",
      title: name ? `Olá, ${name}` : "Olá",
      preheader: "Crie sua senha para ativar seu acesso ao Oxyn CRM.",
      paragraphs: [
        "Você foi convidado para usar o <strong>Oxyn CRM</strong>, a plataforma comercial do Oxyn Group.",
        "Crie sua senha para ativar o acesso.",
      ],
      button: "Criar minha senha",
      link: p.link,
      note: `Este link é pessoal e expira em ${INVITE_TTL_HOURS} horas. Se ele expirar, peça um novo convite ao administrador.`,
    }),
    text: `Olá, ${p.fullName}.\n\nVocê foi convidado para usar o Oxyn CRM. Crie sua senha para ativar o acesso:\n${p.link}\n\nEste link é pessoal e expira em ${INVITE_TTL_HOURS} horas.`,
  };
}

export function recoveryEmail(p: { link: string }): Built {
  return {
    subject: "Redefinição de senha do Oxyn CRM",
    html: layout({
      eyebrow: "Segurança da conta",
      title: "Redefinir sua senha",
      preheader: "Use o link para definir uma nova senha no Oxyn CRM.",
      paragraphs: ["Recebemos um pedido para redefinir a senha da sua conta no <strong>Oxyn CRM</strong>."],
      button: "Definir nova senha",
      link: p.link,
      note: "Se você não fez esse pedido, ignore este e-mail. Sua senha atual continua valendo.",
    }),
    text: `Recebemos um pedido para redefinir a senha da sua conta no Oxyn CRM. Use o link abaixo:\n${p.link}\n\nSe você não fez esse pedido, ignore este e-mail.`,
  };
}

const reminderWhen = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** `dueAt` em UTC (ISO); o horário exibido é o de São Paulo. */
export function reminderEmail(p: { fullName: string; subject: string; dueAt: string | null; link: string }): Built {
  const when = p.dueAt ? reminderWhen.format(new Date(p.dueAt)).replace(", ", " às ") : null;
  const details: Detail[] = [{ label: "Atividade", value: esc(p.subject) }];
  if (when) details.push({ label: "Horário de Brasília", value: esc(when), data: true });
  return {
    subject: `Lembrete: ${p.subject}`,
    html: layout({
      eyebrow: "Lembrete de atividade",
      title: `Olá, ${esc(p.fullName)}`,
      preheader: esc(`${p.subject}${when ? ` · ${when}` : ""}`),
      paragraphs: ["Você tem uma atividade chegando:"],
      details,
      button: "Abrir no Oxyn CRM",
      link: p.link,
    }),
    text: `Olá, ${p.fullName}.\n\nVocê tem uma atividade chegando: ${p.subject}.${when ? `\nHorário: ${when} (horário de Brasília).` : ""}\n\nAbrir no Oxyn CRM:\n${p.link}`,
  };
}
