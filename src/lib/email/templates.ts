type Built = { subject: string; html: string; text: string };

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(opts: {
  title: string;
  paragraphs: string[];
  button: string;
  link: string;
}): string {
  const paras = opts.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#06090F;">${p}</p>`,
    )
    .join("");
  const href = esc(opts.link);
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:0;background:#f4f6f7;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f7;padding:24px 0;"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#111D17;padding:24px 32px;font-family:Montserrat,Arial,sans-serif;font-size:22px;font-weight:700;letter-spacing:4px;color:#ffffff;">OXYN</td></tr>
<tr><td style="padding:32px;">
<h1 style="margin:0 0 16px;font-size:20px;color:#06090F;">${opts.title}</h1>
${paras}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:#1A82A2;border-radius:6px;"><a href="${href}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">${opts.button}</a></td></tr></table>
<p style="margin:0;font-size:13px;line-height:20px;color:#6b7280;">Se o botão não funcionar, copie este endereço no navegador:<br><a href="${href}" style="color:#1A82A2;word-break:break-all;">${href}</a></p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

export function inviteEmail(p: { fullName: string; link: string }): Built {
  const name = esc(p.fullName);
  return {
    subject: "Seu acesso ao Oxyn CRM",
    html: layout({
      title: `Olá, ${name}`,
      paragraphs: [
        "Você foi convidado para usar o Oxyn CRM. Crie sua senha para ativar o acesso.",
        "Este link é pessoal e expira em breve.",
      ],
      button: "Criar minha senha",
      link: p.link,
    }),
    text: `Olá, ${p.fullName}.\n\nVocê foi convidado para usar o Oxyn CRM. Crie sua senha para ativar o acesso:\n${p.link}\n\nEste link é pessoal e expira em breve.`,
  };
}

export function recoveryEmail(p: { link: string }): Built {
  return {
    subject: "Redefinição de senha do Oxyn CRM",
    html: layout({
      title: "Redefinir senha",
      paragraphs: [
        "Recebemos um pedido para redefinir a senha da sua conta no Oxyn CRM.",
        "Se você não fez esse pedido, ignore este e-mail.",
      ],
      button: "Definir nova senha",
      link: p.link,
    }),
    text: `Recebemos um pedido para redefinir a senha da sua conta no Oxyn CRM. Use o link abaixo:\n${p.link}\n\nSe você não fez esse pedido, ignore este e-mail.`,
  };
}
